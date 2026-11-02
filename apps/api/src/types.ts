import type {createDatabase} from '@glitch/db';
export type ReturnTypeOfDatabase=ReturnType<typeof createDatabase>['db'];
