import { MODULE_ICON } from './module-icons';
import { MODULE_LABEL, type ModuleId } from './modules';

describe('MODULE_ICON', () => {
  it('gives every module a distinct icon, one per module in MODULE_LABEL', () => {
    const modules = Object.keys(MODULE_LABEL) as ModuleId[];
    expect(new Set(Object.keys(MODULE_ICON))).toEqual(new Set(modules));

    const icons = Object.values(MODULE_ICON);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
