/* eslint-disable */

// *****************************************************************************
// Copyright (C) 2023 Ericsson and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
// *****************************************************************************

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Based on https://github.com/microsoft/vscode/blob/1.72.2/src/vs/workbench/api/browser/mainThreadTesting.ts

import { VSBuffer } from '@theia/testing/lib/common/buffer';
import { CancellationToken } from '@theia/core/lib/common/cancellation'; // TODO: Test-api: Verify compatibility of namespace
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '@theia/monaco-editor-core/esm/vs/base/common/lifecycle';
import { revive } from '@theia/monaco-editor-core/esm/vs/base/common/marshalling';
import { URI } from '@theia/monaco-editor-core/esm/vs/base/common/uri';
import { Range } from '@theia/monaco-editor-core/esm/vs/editor/common/core/range';
import { MutableObservableValue } from '@theia/testing/lib/common/observable-value'
import { ExtensionRunTestsRequest, IFileCoverage, ITestItem, ITestMessage, ITestRunProfile, ITestRunTask, ResolvedTestRunRequest, TestResultState, TestsDiffOp } from '@theia/testing/lib/common/test-types';
import { TestCoverage } from '@theia/testing/lib/common/test-coverage'
import { ITestProfileService } from '@theia/testing/lib/common/test-profile-service';
import { LiveTestResult } from '@theia/testing/lib/common/test-result';
import { ITestResultService } from '@theia/testing/lib/common/test-result-service';
import { IMainThreadTestController, ITestRootProvider, ITestService } from '@theia/testing/lib/common/test-service';
// import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
// import { ExtHostContext, ExtHostTestingShape, ILocationDto, ITestControllerPatch, MainContext, MainThreadTestingShape } from '../common/extHost.protocol';
import { TestingExt, MAIN_RPC_CONTEXT, TestingMain, ITestControllerPatch } from '../../common/plugin-api-rpc';
import { Location } from '../../common/plugin-api-rpc-model';
import { RPCProtocol } from '../../common/rpc-protocol';
import { interfaces } from '@theia/core/shared/inversify';

// @extHostNamedCustomer(MainContext.MainThreadTesting)
export class TestingMainImpl extends Disposable implements TestingMain, ITestRootProvider {
    private readonly proxy: TestingExt;
    private readonly diffListener = this._register(new MutableDisposable());
    private readonly testProviderRegistrations = new Map<string, {
        instance: IMainThreadTestController;
        label: MutableObservableValue<string>;
        canRefresh: MutableObservableValue<boolean>;
        disposable: IDisposable;
    }>();
    private readonly testService: ITestService;
    private readonly testProfiles: ITestProfileService;
    private readonly resultService: ITestResultService;

    constructor(
        // extHostContext: IExtHostContext,
        rpc: RPCProtocol,
        // @ITestService private readonly testService: ITestService,
        // @ITestProfileService private readonly testProfiles: ITestProfileService,
        // @ITestResultService private readonly resultService: ITestResultService,
        container: interfaces.Container
    ) {
        super();

        this.proxy = rpc.getProxy(MAIN_RPC_CONTEXT.TESTING_EXT);
        this.testService = container.get(ITestService);
        this.testProfiles = container.get(ITestProfileService);
        this.resultService = container.get(ITestResultService);

        this._register(this.testService.onDidCancelTestRun(({ runId }) => {
            this.proxy.$cancelExtensionTestRun(runId);
        }));

        this._register(this.resultService.onResultsChanged(evt => {
            const results = 'completed' in evt ? evt.completed : ('inserted' in evt ? evt.inserted : undefined);
            const serialized = results?.toJSON();
            if (serialized) {
                this.proxy.$publishTestResults([serialized]);
            }
        }));
    }

    /**
     * @inheritdoc
     */
    $publishTestRunProfile(profile: ITestRunProfile): void {
        const controller = this.testProviderRegistrations.get(profile.controllerId);
        if (controller) {
            this.testProfiles.addProfile(controller.instance, profile);
        }
    }

    /**
     * @inheritdoc
     */
    $updateTestRunConfig(controllerId: string, profileId: number, update: Partial<ITestRunProfile>): void {
        this.testProfiles.updateProfile(controllerId, profileId, update);
    }

    /**
     * @inheritdoc
     */
    $removeTestProfile(controllerId: string, profileId: number): void {
        this.testProfiles.removeProfile(controllerId, profileId);
    }

    /**
     * @inheritdoc
     */
    $addTestsToRun(controllerId: string, runId: string, tests: ITestItem.Serialized[]): void {
        this.withLiveRun(runId, r => r.addTestChainToRun(controllerId, tests.map(ITestItem.deserialize)));
    }

    /**
     * @inheritdoc
     */
    $signalCoverageAvailable(runId: string, taskId: string): void {
        this.withLiveRun(runId, run => {
            const task = run.tasks.find(t => t.id === taskId);
            if (!task) {
                return;
            }

            (task.coverage as MutableObservableValue<TestCoverage>).value = new TestCoverage({
                provideFileCoverage: async token => revive<IFileCoverage[]>(await this.proxy.$provideFileCoverage(runId, taskId, token)),
                resolveFileCoverage: (i, token) => this.proxy.$resolveFileCoverage(runId, taskId, i, token),
            });
        });
    }

    /**
     * @inheritdoc
     */
    $startedExtensionTestRun(req: ExtensionRunTestsRequest): void {
        this.resultService.createLiveResult(req);
    }

    /**
     * @inheritdoc
     */
    $startedTestRunTask(runId: string, task: ITestRunTask): void {
        this.withLiveRun(runId, r => r.addTask(task));
    }

    /**
     * @inheritdoc
     */
    $finishedTestRunTask(runId: string, taskId: string): void {
        this.withLiveRun(runId, r => r.markTaskComplete(taskId));
    }

    /**
     * @inheritdoc
     */
    $finishedExtensionTestRun(runId: string): void {
        this.withLiveRun(runId, r => r.markComplete());
    }

    /**
     * @inheritdoc
     */
    public $updateTestStateInRun(runId: string, taskId: string, testId: string, state: TestResultState, duration?: number): void {
        this.withLiveRun(runId, r => r.updateState(testId, taskId, state, duration));
    }

    /**
     * @inheritdoc
     */
    public $appendOutputToRun(runId: string, taskId: string, output: VSBuffer, locationDto?: Location, testId?: string): void {
        const location = locationDto && {
            uri: URI.revive(locationDto.uri),
            range: Range.lift(locationDto.range)
        };

        this.withLiveRun(runId, r => r.appendOutput(output, taskId, location, testId));
    }


    /**
     * @inheritdoc
     */
    public $appendTestMessagesInRun(runId: string, taskId: string, testId: string, messages: ITestMessage.Serialized[]): void {
        const r = this.resultService.getResult(runId);
        if (r && r instanceof LiveTestResult) {
            for (const message of messages) {
                r.appendMessage(testId, taskId, ITestMessage.deserialize(message));
            }
        }
    }

    /**
     * @inheritdoc
     */
    public $registerTestController(controllerId: string, labelStr: string, canRefreshValue: boolean) {
        const disposable = new DisposableStore();
        const label = disposable.add(new MutableObservableValue(labelStr));
        const canRefresh = disposable.add(new MutableObservableValue(canRefreshValue));
        const controller: IMainThreadTestController = {
            id: controllerId,
            label,
            canRefresh,
            refreshTests: token => this.proxy.$refreshTests(controllerId, token),
            configureRunProfile: id => this.proxy.$configureRunProfile(controllerId, id),
            runTests: (reqs, token) => this.proxy.$runControllerTests(reqs, token),
            expandTest: (testId, levels) => this.proxy.$expandTest(testId, isFinite(levels) ? levels : -1),
        };

        disposable.add(toDisposable(() => this.testProfiles.removeProfile(controllerId)));
        disposable.add(this.testService.registerTestController(controllerId, controller));

        this.testProviderRegistrations.set(controllerId, {
            instance: controller,
            label,
            canRefresh,
            disposable
        });
    }

    /**
     * @inheritdoc
     */
    public $updateController(controllerId: string, patch: ITestControllerPatch) {
        const controller = this.testProviderRegistrations.get(controllerId);
        if (!controller) {
            return;
        }

        if (patch.label !== undefined) {
            controller.label.value = patch.label;
        }

        if (patch.canRefresh !== undefined) {
            controller.canRefresh.value = patch.canRefresh;
        }
    }

    /**
     * @inheritdoc
     */
    public $unregisterTestController(controllerId: string) {
        this.testProviderRegistrations.get(controllerId)?.disposable.dispose();
        this.testProviderRegistrations.delete(controllerId);
    }

    /**
     * @inheritdoc
     */
    public $subscribeToDiffs(): void {
        this.proxy.$acceptDiff(this.testService.collection.getReviverDiff().map(TestsDiffOp.serialize));
        this.diffListener.value = this.testService.onDidProcessDiff(this.proxy.$acceptDiff, this.proxy);
    }

    /**
     * @inheritdoc
     */
    public $unsubscribeFromDiffs(): void {
        this.diffListener.clear();
    }

    /**
     * @inheritdoc
     */
    public $publishDiff(controllerId: string, diff: TestsDiffOp.Serialized[]): void {
        this.testService.publishDiff(controllerId, diff.map(TestsDiffOp.deserialize));
    }

    public async $runTests(req: ResolvedTestRunRequest, token: CancellationToken): Promise<string> {
        const result = await this.testService.runResolvedTests(req, token);
        return result.id;
    }

    public override dispose() {
        super.dispose();
        for (const subscription of this.testProviderRegistrations.values()) {
            subscription.disposable.dispose();
        }
        this.testProviderRegistrations.clear();
    }

    private withLiveRun<T>(runId: string, fn: (run: LiveTestResult) => T): T | undefined {
        const r = this.resultService.getResult(runId);
        return r && r instanceof LiveTestResult ? fn(r) : undefined;
    }
}
