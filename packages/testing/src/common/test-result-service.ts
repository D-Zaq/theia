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

/* eslint-disable */

import { ArrayUtils } from '@theia/core/lib/common/array-utils';
import { RunOnceScheduler } from '@theia/monaco-editor-core/esm/vs/base/common/async';
import { Emitter, Event } from '@theia/monaco-editor-core/esm/vs/base/common/event';
import { once } from './test-service';
import { Iterable } from '@theia/monaco-editor-core/esm/vs/base/common/iterator';
import { generateUuid } from '@theia/core/lib/common/uuid';
import { IContextKey, IContextKeyService } from '@theia/monaco-editor-core/esm/vs/platform/contextkey/common/contextkey';
import { createDecorator } from '@theia/monaco-editor-core/esm/vs/platform/instantiation/common/instantiation';
import { ExtensionRunTestsRequest, ITestRunProfile, ResolvedTestRunRequest, TestResultItem, TestResultState } from './test-types';
import { TestingContextKeys } from './testing-context-keys';
import { ITestProfileService } from './test-profile-service';
import { ITestResult, LiveTestResult, TestResultItemChange, TestResultItemChangeReason } from './test-result';
import { ITestResultStorage, RETAIN_MAX_RESULTS } from './test-result-storage';

export type ResultChangeEvent =
    | { completed: LiveTestResult }
    | { started: LiveTestResult }
    | { inserted: ITestResult }
    | { removed: ITestResult[] };

export const allChangedResults = (evt: ResultChangeEvent): Iterable<ITestResult> => 'completed' in evt
    ? Iterable.single(evt.completed)
    : 'started' in evt
        ? Iterable.single(evt.started)
        : 'inserted' in evt
            ? Iterable.single(evt.inserted)
            : evt.removed;

export interface ITestResultService {
    readonly _serviceBrand: undefined;
    /**
     * Fired after any results are added, removed, or completed.
     */
    readonly onResultsChanged: Event<ResultChangeEvent>;

    /**
     * Fired when a test changed it state, or its computed state is updated.
     */
    readonly onTestChanged: Event<TestResultItemChange>;

    /**
     * List of known test results.
     */
    readonly results: ReadonlyArray<ITestResult>;

    /**
     * Discards all completed test results.
     */
    clear(): void;

    /**
     * Creates a new, live test result.
     */
    createLiveResult(req: ResolvedTestRunRequest | ExtensionRunTestsRequest): LiveTestResult;

    /**
     * Adds a new test result to the collection.
     */
    push<T extends ITestResult>(result: T): T;

    /**
     * Looks up a set of test results by ID.
     */
    getResult(resultId: string): ITestResult | undefined;

    /**
     * Looks up a test's most recent state, by its extension-assigned ID.
     */
    getStateById(extId: string): [results: ITestResult, item: TestResultItem] | undefined;
}

export const isRunningTests = (service: ITestResultService) =>
    service.results.length > 0 && service.results[0].completedAt === undefined;

export const ITestResultService = createDecorator<ITestResultService>('testResultService');

export class TestResultService implements ITestResultService {
    declare _serviceBrand: undefined;
    private changeResultEmitter = new Emitter<ResultChangeEvent>();
    private _results: ITestResult[] = [];
    private testChangeEmitter = new Emitter<TestResultItemChange>();

    /**
     * @inheritdoc
     */
    public get results() {
        this.loadResults();
        return this._results;
    }

    /**
     * @inheritdoc
     */
    public readonly onResultsChanged = this.changeResultEmitter.event;

    /**
     * @inheritdoc
     */
    public readonly onTestChanged = this.testChangeEmitter.event;

    private readonly isRunning: IContextKey<boolean>;
    private readonly hasAnyResults: IContextKey<boolean>;
    private readonly loadResults = once(() => this.storage.read().then(loaded => {
        for (let i = loaded.length - 1; i >= 0; i--) {
            this.push(loaded[i]);
        }
    }));

    protected readonly persistScheduler = new RunOnceScheduler(() => this.persistImmediately(), 500);

    constructor(
        @IContextKeyService contextKeyService: IContextKeyService,
        @ITestResultStorage private readonly storage: ITestResultStorage,
        @ITestProfileService private readonly testProfiles: ITestProfileService,
    ) {
        this.isRunning = TestingContextKeys.isRunning.bindTo(contextKeyService);
        this.hasAnyResults = TestingContextKeys.hasAnyResults.bindTo(contextKeyService);
    }

    /**
     * @inheritdoc
     */
    public getStateById(extId: string): [results: ITestResult, item: TestResultItem] | undefined {
        for (const result of this.results) {
            const lookup = result.getStateById(extId);
            if (lookup && lookup.computedState !== TestResultState.Unset) {
                return [result, lookup];
            }
        }

        return undefined;
    }

    /**
     * @inheritdoc
     */
    public createLiveResult(req: ResolvedTestRunRequest | ExtensionRunTestsRequest) {
        if ('targets' in req) {
            const id = generateUuid();
            return this.push(new LiveTestResult(id, this.storage.getOutputController(id), true, req));
        }

        let profile: ITestRunProfile | undefined;
        if (req.profile) {
            const profiles = this.testProfiles.getControllerProfiles(req.controllerId);
            profile = profiles.find(c => c.profileId === req.profile!.id);
        }

        const resolved: ResolvedTestRunRequest = {
            isUiTriggered: false,
            targets: [],
            exclude: req.exclude,
            isAutoRun: false,
        };

        if (profile) {
            resolved.targets.push({
                profileGroup: profile.group,
                profileId: profile.profileId,
                controllerId: req.controllerId,
                testIds: req.include,
            });
        }

        return this.push(new LiveTestResult(req.id, this.storage.getOutputController(req.id), req.persist, resolved));
    }

    /**
     * @inheritdoc
     */
    public push<T extends ITestResult>(result: T): T {
        if (result.completedAt === undefined) {
            this.results.unshift(result);
        } else {
            const index = ArrayUtils.findFirstInSorted(this.results, r => r.completedAt !== undefined && r.completedAt <= result.completedAt!);
            this.results.splice(index, 0, result);
            this.persistScheduler.schedule();
        }

        this.hasAnyResults.set(true);
        if (this.results.length > RETAIN_MAX_RESULTS) {
            this.results.pop();
        }

        if (result instanceof LiveTestResult) {
            result.onComplete(() => this.onComplete(result));
            result.onChange(this.testChangeEmitter.fire, this.testChangeEmitter);
            this.isRunning.set(true);
            this.changeResultEmitter.fire({ started: result });
        } else {
            this.changeResultEmitter.fire({ inserted: result });
            // If this is not a new result, go through each of its tests. For each
            // test for which the new result is the most recently inserted, fir
            // a change event so that UI updates.
            for (const item of result.tests) {
                for (const otherResult of this.results) {
                    if (otherResult === result) {
                        this.testChangeEmitter.fire({ item, result, reason: TestResultItemChangeReason.ComputedStateChange });
                        break;
                    } else if (otherResult.getStateById(item.item.extId) !== undefined) {
                        break;
                    }
                }
            }
        }

        return result;
    }

    /**
     * @inheritdoc
     */
    public getResult(id: string) {
        return this.results.find(r => r.id === id);
    }

    /**
     * @inheritdoc
     */
    public clear() {
        const keep: ITestResult[] = [];
        const removed: ITestResult[] = [];
        for (const result of this.results) {
            if (result.completedAt !== undefined) {
                removed.push(result);
            } else {
                keep.push(result);
            }
        }

        this._results = keep;
        this.persistScheduler.schedule();
        if (keep.length === 0) {
            this.hasAnyResults.set(false);
        }
        this.changeResultEmitter.fire({ removed });
    }

    private onComplete(result: LiveTestResult) {
        this.resort();
        this.updateIsRunning();
        this.persistScheduler.schedule();
        this.changeResultEmitter.fire({ completed: result });
    }

    private resort() {
        this.results.sort((a, b) => (b.completedAt ?? Number.MAX_SAFE_INTEGER) - (a.completedAt ?? Number.MAX_SAFE_INTEGER));
    }

    private updateIsRunning() {
        this.isRunning.set(isRunningTests(this));
    }

    protected async persistImmediately() {
        // ensure results are loaded before persisting to avoid deleting once
        // that we don't have yet.
        await this.loadResults();
        this.storage.persist(this.results);
    }
}
