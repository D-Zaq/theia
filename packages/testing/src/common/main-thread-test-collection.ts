// *****************************************************************************
// Copyright (C) 2022 Ericsson and others.
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

import { Emitter } from '@theia/monaco-editor-core/esm/vs/base/common/event';
import { Iterable } from '@theia/monaco-editor-core/esm/vs/base/common/iterator';
import { AbstractIncrementalTestCollection, IncrementalTestCollectionItem, InternalTestItem, TestDiffOpType, TestsDiff } from './test-types';
import { IMainThreadTestCollection } from './test-service';
import { injectable } from '@theia/core/shared/inversify';

@injectable()
export class MainThreadTestCollection extends AbstractIncrementalTestCollection<IncrementalTestCollectionItem> implements IMainThreadTestCollection {
    private busyProvidersChangeEmitter = new Emitter<number>();
    private expandPromises = new WeakMap<IncrementalTestCollectionItem, {
        pendingLvl: number;
        doneLvl: number;
        prom: Promise<void>;
    }>();

    /**
     * @inheritdoc
     */
    public get busyProviders() {
        return this.busyControllerCount;
    }

    /**
     * @inheritdoc
     */
    public get rootItems() {
        return this.roots;
    }

    /**
     * @inheritdoc
     */
    public get all() {
        return this.getIterator();
    }

    public get rootIds() {
        return Iterable.map(this.roots.values(), r => r.item.extId);
    }

    public readonly onBusyProvidersChange = this.busyProvidersChangeEmitter.event;

    constructor(private readonly expandActual: (id: string, levels: number) => Promise<void>) {
        super();
    }

    /**
     * @inheritdoc
     */
    public expand(testId: string, levels: number): Promise<void> {
        const test = this.items.get(testId);
        if (!test) {
            return Promise.resolve();
        }

        // simple cache to avoid duplicate/unnecessary expansion calls
        const existing = this.expandPromises.get(test);
        if (existing && existing.pendingLvl >= levels) {
            return existing.prom;
        }

        const prom = this.expandActual(test.item.extId, levels);
        const record = { doneLvl: existing ? existing.doneLvl : -1, pendingLvl: levels, prom };
        this.expandPromises.set(test, record);

        return prom.then(() => {
            record.doneLvl = levels;
        });
    }

    /**
     * @inheritdoc
     */
    public getNodeById(id: string) {
        return this.items.get(id);
    }

    /**
     * @inheritdoc
     */
    public getReviverDiff() {
        const ops: TestsDiff = [{ op: TestDiffOpType.IncrementPendingExtHosts, amount: this.pendingRootCount }];

        const queue = [this.rootIds];
        while (queue.length) {
            for (const child of queue.pop()!) {
                const item = this.items.get(child)!;
                ops.push({
                    op: TestDiffOpType.Add, item: {
                        controllerId: item.controllerId,
                        expand: item.expand,
                        item: item.item,
                        parent: item.parent,
                    }
                });
                queue.push(item.children);
            }
        }

        return ops;
    }

    /**
     * Applies the diff to the collection.
     */
    public override apply(diff: TestsDiff) {
        const prevBusy = this.busyControllerCount;
        super.apply(diff);

        if (prevBusy !== this.busyControllerCount) {
            this.busyProvidersChangeEmitter.fire(this.busyControllerCount);
        }
    }

    /**
     * Clears everything from the collection, and returns a diff that applies
     * that action.
     */
    public clear() {
        const ops: TestsDiff = [];
        for (const root of this.roots) {
            ops.push({ op: TestDiffOpType.Remove, itemId: root.item.extId });
        }

        this.roots.clear();
        this.items.clear();

        return ops;
    }

    /**
     * @override
     */
    protected createItem(internal: InternalTestItem): IncrementalTestCollectionItem {
        return { ...internal, children: new Set() };
    }

    private *getIterator() {
        const queue = [this.rootIds];
        while (queue.length) {
            for (const id of queue.pop()!) {
                const node = this.getNodeById(id)!;
                yield node;
                queue.push(node.children);
            }
        }
    }
}
