/**
 * Install the resolve hook next door, so
 * `node --conditions=react-server --import ./scripts/ts-resolve.mjs <script>.ts` can import the
 * frontend's aliased, extensionless modules. Two files rather than one because module hooks run
 * on their own thread and must be registered from outside themselves.
 */
import { register } from 'node:module';

register('./ts-resolve-hooks.mjs', import.meta.url);
