import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createContactDirectory } from './contacts.ts';

interface FixtureContact {
  first?: string;
  last?: string;
  organization?: string;
  phones?: string[];
  emails?: string[];
}

function writeAddressBook(file: string, contacts: FixtureContact[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  try {
    database.exec(
      `create table ZABCDRECORD (
         Z_PK integer primary key, ZFIRSTNAME text, ZLASTNAME text, ZORGANIZATION text
       )`,
    );
    database.exec(
      'create table ZABCDPHONENUMBER (Z_PK integer primary key, ZOWNER integer, ZFULLNUMBER text)',
    );
    database.exec(
      'create table ZABCDEMAILADDRESS (Z_PK integer primary key, ZOWNER integer, ZADDRESS text)',
    );

    let owner = 0;
    for (const contact of contacts) {
      owner += 1;
      const columns = ['Z_PK'];
      const values: (string | number)[] = [owner];
      if (contact.first !== undefined) {
        columns.push('ZFIRSTNAME');
        values.push(contact.first);
      }
      if (contact.last !== undefined) {
        columns.push('ZLASTNAME');
        values.push(contact.last);
      }
      if (contact.organization !== undefined) {
        columns.push('ZORGANIZATION');
        values.push(contact.organization);
      }
      database
        .prepare(
          `insert into ZABCDRECORD (${columns.join(', ')})
           values (${columns.map(() => '?').join(', ')})`,
        )
        .run(...values);
      for (const phone of contact.phones ?? []) {
        database
          .prepare('insert into ZABCDPHONENUMBER (ZOWNER, ZFULLNUMBER) values (?, ?)')
          .run(owner, phone);
      }
      for (const email of contact.emails ?? []) {
        database
          .prepare('insert into ZABCDEMAILADDRESS (ZOWNER, ZADDRESS) values (?, ?)')
          .run(owner, email);
      }
    }
  } finally {
    database.close();
  }
}

let directory: string;
let counter = 0;

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'alfred-addressbook-'));
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

function root(): string {
  counter += 1;
  return path.join(directory, `root-${String(counter)}`);
}

describe('createContactDirectory', () => {
  it('names a sender whose number the address book stores in a human format', () => {
    const base = root();
    writeAddressBook(path.join(base, 'AddressBook-v22.abcddb'), [
      { first: 'Dana', last: 'Reyes', phones: ['(312) 555-0100'] },
    ]);

    expect(createContactDirectory({ root: base }).nameFor('+13125550100')).toBe('Dana Reyes');
  });

  it('names a sender by email, whatever the case either side is written in', () => {
    const base = root();
    writeAddressBook(path.join(base, 'AddressBook-v22.abcddb'), [
      { first: 'Dana', emails: ['Dana@Example.com'] },
    ]);

    expect(createContactDirectory({ root: base }).nameFor('dana@example.com')).toBe('Dana');
  });

  it('falls back to the organization when the record has no personal name', () => {
    const base = root();
    writeAddressBook(path.join(base, 'AddressBook-v22.abcddb'), [
      { organization: 'Riverside Dental', phones: ['+13125550111'] },
    ]);

    expect(createContactDirectory({ root: base }).nameFor('+13125550111')).toBe('Riverside Dental');
  });

  it('reads the per-account stores under Sources/, not only the root one', () => {
    const base = root();
    writeAddressBook(path.join(base, 'AddressBook-v22.abcddb'), [
      { first: 'Root', phones: ['+13125550100'] },
    ]);
    writeAddressBook(path.join(base, 'Sources', 'ABCD-1234', 'AddressBook-v22.abcddb'), [
      { first: 'Sam', last: 'Okafor', phones: ['+13125550122'] },
    ]);

    expect(createContactDirectory({ root: base }).nameFor('+13125550122')).toBe('Sam Okafor');
  });

  it('has no name for a handle nobody in the address book owns', () => {
    const base = root();
    writeAddressBook(path.join(base, 'AddressBook-v22.abcddb'), [
      { first: 'Dana', phones: ['+13125550100'] },
    ]);

    expect(createContactDirectory({ root: base }).nameFor('+13125559999')).toBeUndefined();
  });

  it('resolves names without re-reading the stores on every lookup', () => {
    const base = root();
    const file = path.join(base, 'AddressBook-v22.abcddb');
    writeAddressBook(file, [{ first: 'Dana', phones: ['+13125550100'] }]);
    const contacts = createContactDirectory({ root: base });

    expect(contacts.nameFor('+13125550100')).toBe('Dana');
    rmSync(file);

    expect(contacts.nameFor('+13125550100')).toBe('Dana');
  });

  it('stays quiet when the address book is unreadable — a name is never worth an error', () => {
    const contacts = createContactDirectory({ root: path.join(directory, 'not-there') });

    expect(contacts.nameFor('+13125550100')).toBeUndefined();
  });

  it('stays quiet when a store is not a database at all', () => {
    const base = root();
    mkdirSync(base, { recursive: true });
    writeFileSync(path.join(base, 'AddressBook-v22.abcddb'), 'not a sqlite file');

    expect(createContactDirectory({ root: base }).nameFor('+13125550100')).toBeUndefined();
  });

  it('stays quiet when a store has drifted to a schema it does not recognise', () => {
    const base = root();
    mkdirSync(base, { recursive: true });
    const database = new DatabaseSync(path.join(base, 'AddressBook-v22.abcddb'));
    database.exec('create table ZSOMETHINGELSE (Z_PK integer primary key)');
    database.close();

    expect(createContactDirectory({ root: base }).nameFor('+13125550100')).toBeUndefined();
  });
});
