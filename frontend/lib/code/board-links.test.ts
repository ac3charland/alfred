import { projectBoardHref, storyBoardHref } from './board-links';

describe('projectBoardHref', () => {
  it('builds the project board path', () => {
    expect(projectBoardHref('p1')).toBe('/code/p1');
  });
});

describe('storyBoardHref', () => {
  it('builds a `?story=` deep link onto the story project board', () => {
    expect(storyBoardHref('p1', 'ALF-42')).toBe('/code/p1?story=ALF-42');
  });

  it('encodes the ref so an unusual key survives the round trip', () => {
    expect(storyBoardHref('p1', 'A B-1')).toBe('/code/p1?story=A%20B-1');
  });

  it('falls back to the plain board path when the ref is empty', () => {
    expect(storyBoardHref('p1', '')).toBe('/code/p1');
  });
});
