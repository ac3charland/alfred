import { splitSnippet } from './snippet';

const START = '\u0002';
const STOP = '\u0003';

describe('splitSnippet — a body-search snippet into plain and marked runs', () => {
  it('marks the words between the delimiters', () => {
    expect(splitSnippet(`…argues that ${START}forgetting${STOP} is the brain…`)).toEqual([
      { text: '…argues that ', marked: false },
      { text: 'forgetting', marked: true },
      { text: ' is the brain…', marked: false },
    ]);
  });

  it('marks several matches, including one at either end', () => {
    expect(splitSnippet(`${START}habit${STOP} and ${START}habits${STOP}`)).toEqual([
      { text: 'habit', marked: true },
      { text: ' and ', marked: false },
      { text: 'habits', marked: true },
    ]);
  });

  it('returns a snippet with no marks as one plain run', () => {
    expect(splitSnippet('no matches here')).toEqual([{ text: 'no matches here', marked: false }]);
  });

  it('never reads markup as markup — HTML in a snippet stays text', () => {
    expect(splitSnippet(`<b>${START}x${STOP}</b>`)).toEqual([
      { text: '<b>', marked: false },
      { text: 'x', marked: true },
      { text: '</b>', marked: false },
    ]);
  });

  it('drops a stray stop and runs an unclosed start to the end', () => {
    expect(splitSnippet(`a${STOP}b ${START}c`)).toEqual([
      { text: 'ab ', marked: false },
      { text: 'c', marked: true },
    ]);
  });

  it('drops an empty marked run', () => {
    expect(splitSnippet(`a${START}${STOP}b`)).toEqual([{ text: 'ab', marked: false }]);
  });

  it('answers nothing for an empty snippet', () => {
    expect(splitSnippet('')).toEqual([]);
  });
});
