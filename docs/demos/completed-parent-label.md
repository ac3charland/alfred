# Completed screen: parent folder label

*2026-06-10T21:02:45.427Z*

Each completed item now shows its parent folder (or "Inbox") in low-contrast text beneath the task title, with a ListCheck icon. This gives context at a glance when viewing completed items from different projects in one list.

The label is computed in TaskRow: when isCompleted && depth === 0, it resolves the folder name from the store or falls back to "Inbox". It is hidden in all other views (inbox, folder views) and for nested subtasks.

```bash
npm run test -w frontend -- --json --outputFile=/tmp/jest-results.json --testPathPatterns='task-row' > /dev/null 2>&1; node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/jest-results.json','utf8'));
const suite = d.testResults[0];
console.log('PASS components/tasks/task-row.test.tsx');
console.log('');
for (const t of suite.assertionResults) {
  const label = t.ancestorTitles.slice(1).concat(t.title).join(' > ');
  const tag = ['shows the folder name','shows \"Inbox\"','does not show parent'].some(s => t.title.includes(s.replace(/\\\"/g,'\"'))) ? ' [new]' : '';
  console.log('  pass ' + label + tag);
}
console.log('');
console.log('Tests: ' + d.numPassedTests + ' passed, ' + d.numTotalTests + ' total');
"
```

```output
PASS components/tasks/task-row.test.tsx

  pass renders the task title
  pass renders the completion checkbox with "complete" label for active tasks
  pass renders checkbox with "active" label in the completed view
  pass renders checkbox as checked (teal fill) in the completed view
  pass expand/collapse toggle is invisible when there are no children
  pass expand toggle is visible when node has children
  pass shows child tasks when the expand toggle is clicked
  pass hides child tasks when expanded and then collapsed
  pass removes the task from the view immediately on checkbox click
  pass calls completeTask when the checkbox is clicked (no children)
  pass restores the task when completeTask fails
  pass opens the cascade modal when checkbox is clicked on a task with children
  pass does NOT call completeTask directly when the cascade modal opens
  pass calls updateItem with status:active when uncompleting
  pass removes the task from the completed view immediately when uncompleting
  pass shows the folder name under a completed root item [new]
  pass shows "Inbox" under a completed root item with no folder [new]
  pass does not show parent label in the inbox view [new]
  pass restores the task when updateItem fails while uncompleting
  pass shows due date chip when due_date is present
  pass deletes the task via the actions menu
  pass move to folder > calls updateItem once when moving a leaf task to a folder
  pass move to folder > calls updateItem for parent and all descendants when moving to a folder
  pass move to folder > calls moveToInbox once when moving a leaf task to the inbox
  pass move to folder > calls moveToInbox for parent and all descendants when moving to the inbox
  pass inline title editing > enters edit mode on double-click of the title
  pass inline title editing > shows the current title value in the edit input
  pass inline title editing > saves the title and calls updateItem when Enter is pressed
  pass inline title editing > saves the title when the confirm button is clicked
  pass inline title editing > cancels the edit on Escape without calling updateItem
  pass inline title editing > does not call updateItem when the title is unchanged
  pass inline title editing > reverts to the original title if updateItem fails
  pass inline title editing > exits edit mode after a successful save

Tests: 33 passed, 33 total
```
