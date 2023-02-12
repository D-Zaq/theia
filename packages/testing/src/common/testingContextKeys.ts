/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Based on https://github.com/microsoft/vscode/blob/1.72.2/src/vs/workbench/contrib/testing/common/testingContextKeys.ts

import { localize } from '@theia/monaco-editor-core/esm/vs/nls';
import { RawContextKey } from '@theia/monaco-editor-core/esm/vs/platform/contextkey/common/contextkey';
import { TestExplorerViewMode, TestExplorerViewSorting } from './constants';
import { TestRunProfileBitset } from './test-types';

export namespace TestingContextKeys {
	export const providerCount = new RawContextKey('testing.providerCount', 0);
	export const canRefreshTests = new RawContextKey('testing.canRefresh', false, { type: 'boolean', description: localize('testing.canRefresh', 'Indicates whether any test controller has an attached refresh handler.') });
	export const isRefreshingTests = new RawContextKey('testing.isRefreshing', false, { type: 'boolean', description: localize('testing.isRefreshing', 'Indicates whether any test controller is currently refreshing tests.') });
	export const hasDebuggableTests = new RawContextKey('testing.hasDebuggableTests', false, { type: 'boolean', description: localize('testing.hasDebuggableTests', 'Indicates whether any test controller has registered a debug configuration') });
	export const hasRunnableTests = new RawContextKey('testing.hasRunnableTests', false, { type: 'boolean', description: localize('testing.hasRunnableTests', 'Indicates whether any test controller has registered a run configuration') });
	export const hasCoverableTests = new RawContextKey('testing.hasCoverableTests', false, { type: 'boolean', description: localize('testing.hasCoverableTests', 'Indicates whether any test controller has registered a coverage configuration') });
	export const hasNonDefaultProfile = new RawContextKey('testing.hasNonDefaultProfile', false, { type: 'boolean', description: localize('testing.hasNonDefaultConfig', 'Indicates whether any test controller has registered a non-default configuration') });
	export const hasConfigurableProfile = new RawContextKey('testing.hasConfigurableProfile', false, { type: 'boolean', description: localize('testing.hasConfigurableConfig', 'Indicates whether any test configuration can be configured') });

	export const capabilityToContextKey: { [K in TestRunProfileBitset]: RawContextKey<boolean> } = {
		[TestRunProfileBitset.Run]: hasRunnableTests,
		[TestRunProfileBitset.Coverage]: hasCoverableTests,
		[TestRunProfileBitset.Debug]: hasDebuggableTests,
		[TestRunProfileBitset.HasNonDefaultProfile]: hasNonDefaultProfile,
		[TestRunProfileBitset.HasConfigurable]: hasConfigurableProfile,
	};

	export const hasAnyResults = new RawContextKey<boolean>('testing.hasAnyResults', false);
	export const viewMode = new RawContextKey<TestExplorerViewMode>('testing.explorerViewMode', TestExplorerViewMode.List);
	export const viewSorting = new RawContextKey<TestExplorerViewSorting>('testing.explorerViewSorting', TestExplorerViewSorting.ByLocation);
	export const isRunning = new RawContextKey<boolean>('testing.isRunning', false);
	export const isInPeek = new RawContextKey<boolean>('testing.isInPeek', true);
	export const isPeekVisible = new RawContextKey<boolean>('testing.isPeekVisible', false);
	export const autoRun = new RawContextKey<boolean>('testing.autoRun', false);

	export const peekItemType = new RawContextKey<string | undefined>('peekItemType', undefined, {
		type: 'string',
		description: localize('testing.peekItemType', 'Type of the item in the output peek view. Either a "test", "message", "task", or "result".'),
	});
	export const controllerId = new RawContextKey<string | undefined>('controllerId', undefined, {
		type: 'string',
		description: localize('testing.controllerId', 'Controller ID of the current test item')
	});
	export const testItemExtId = new RawContextKey<string | undefined>('testId', undefined, {
		type: 'string',
		description: localize('testing.testId', 'ID of the current test item, set when creating or opening menus on test items')
	});
	export const testItemHasUri = new RawContextKey<boolean>('testing.testItemHasUri', false, {
		type: 'boolean',
		description: localize('testing.testItemHasUri', 'Boolean indicating whether the test item has a URI defined')
	});
	export const testItemIsHidden = new RawContextKey<boolean>('testing.testItemIsHidden', false, {
		type: 'boolean',
		description: localize('testing.testItemIsHidden', 'Boolean indicating whether the test item is hidden')
	});
}
