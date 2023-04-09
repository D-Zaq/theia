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

import { ContainerModule } from '@theia/core/shared/inversify';
import '../../src/browser/style/index.css';
import './tasks-monaco-contribution';
import { TestProfileService } from '../common/test-profile-service';
import { TestResultService } from '../common/test-result-service';
import { TestService } from '../common/test-service-impl';
import { ContextKeyService, ContextKeyServiceDummyImpl } from '@theia/core/lib/browser/context-key-service';

export default new ContainerModule(bind => {
    bind(TestService).toSelf().inSingletonScope();
    bind(TestProfileService).toSelf().inSingletonScope();
    bind(TestResultService).toSelf().inSingletonScope();

    bind(ContextKeyService).to(ContextKeyServiceDummyImpl).inSingletonScope();
    // bind(ContextKeyService).toSelf().inSingletonScope();
});
