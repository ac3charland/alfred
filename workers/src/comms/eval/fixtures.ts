/**
 * The evaluation set: hand-written messages with the answer the owner would have given.
 *
 * This is the only instrument in the module that can see a FALSE NEGATIVE. A wrongly-shelved
 * message never becomes a correction — nothing forces the owner to open the shelf — so the
 * correction rate measures the demotion rate and is structurally blind to the failure that
 * matters most. These fixtures are what make "is the recall bias still there?" and "should this
 * be a bigger model?" measurements rather than opinions.
 *
 * Everything here is synthetic: invented people, invented companies, invented addresses. The set
 * is deliberately varied in the ways real traffic is — a colleague who is genuinely blocked, a
 * newsletter that leaked the header filter, a photo with no text from someone who matters and
 * from someone who does not, a group chat that names the owner and one that does not, a vendor
 * being loud about an invoice, and a good deal of mail that asks nothing at all.
 */
import type { CommAccount, CommMessage, CommPerson, CommRubric, CommTier } from '../types';

/** The instant the fixtures are dated against, so a run is reproducible. */
export const FIXTURE_NOW = new Date('2026-09-09T15:00:00.000Z');

export const FIXTURE_TIME_ZONE = 'America/Chicago';

/** What the owner would have said, and the two questions the score is computed from. */
export interface ExpectedJudgment {
  /** Whether it belongs in the queue at all — the boundary recall is measured at. */
  queued: boolean;
  tier: CommTier;
}

/** One message with its right answer, ready to be built into a request. */
export interface CommFixture {
  id: string;
  /** A one-line note on what the case is testing, for reading a failure. */
  about: string;
  account: CommAccount;
  message: CommMessage;
  expected: ExpectedJudgment;
}

function account(
  id: string,
  key: string,
  kind: CommAccount['kind'],
  label: string,
  ownerHandle: string,
): CommAccount {
  return {
    id,
    key,
    kind,
    label,
    home: kind === 'imessage' ? 'daemon' : 'worker',
    owner_handles: [ownerHandle],
    enabled: true,
    expected_interval_seconds: 600,
    cursor: undefined,
  };
}

export const PERSONAL = account(
  'acc-1',
  'gmail-personal',
  'gmail',
  'personal',
  'alex@mail.example',
);
export const WORK = account('acc-2', 'gmail-work', 'gmail', 'Northwind', 'alex@northwind.example');
export const WORKMAIL = account('acc-3', 'workmail', 'imap', 'WorkMail', 'a.reyes@corp.example');
export const IMESSAGE = account('acc-4', 'imessage', 'imessage', 'iMessage', '+15125550100');

export const FIXTURE_ACCOUNTS = [PERSONAL, WORK, WORKMAIL, IMESSAGE];

export const FIXTURE_PEOPLE: CommPerson[] = [
  {
    id: 'p-priya',
    name: 'Priya Reyes',
    priority: 'high',
    notes: 'My wife.',
    handles: [
      { handle: '+15125550111', kind: 'phone' },
      { handle: 'priya@mail.example', kind: 'email' },
    ],
  },
  {
    id: 'p-dana',
    name: 'Dana Whitfield',
    priority: 'high',
    notes: 'Runs delivery at Northwind; if she is blocked, the release is blocked.',
    handles: [{ handle: 'dana@northwind.example', kind: 'email' }],
  },
  {
    id: 'p-marcus',
    name: 'Marcus Feld',
    priority: 'normal',
    handles: [{ handle: 'marcus@northwind.example', kind: 'email' }],
  },
  {
    id: 'p-trevor',
    name: 'Trevor Boyd',
    priority: 'low',
    notes: 'Vendor account rep. Everything he sends sounds urgent and never is.',
    handles: [{ handle: 'trevor@vendorly.example', kind: 'email' }],
  },
  {
    id: 'p-sam',
    name: 'Sam Okafor',
    priority: 'normal',
    notes: 'Neighbour.',
    handles: [{ handle: '+13125550188', kind: 'phone' }],
  },
];

export const FIXTURE_RUBRIC: CommRubric = {
  id: 'rubric-eval',
  version: 1,
  created_at: '2026-09-01T00:00:00.000Z',
  body: [
    'The owner is Alex Reyes.',
    'Anything from Priya is asap unless it is plainly chit-chat.',
    'Vendor and sales mail is never urgent, whatever it claims about itself.',
    "Anything about the kids' school needs an answer the same day.",
    'Automated mail that says "do not reply" is fyi even when it names a date.',
  ].join('\n'),
};

interface FixtureInput {
  id: string;
  about: string;
  account: CommAccount;
  from: string;
  name?: string;
  subject?: string;
  body: string;
  chat?: { name: string; participants: string[] };
  attachments?: boolean;
  minutesAgo?: number;
  tier: CommTier;
}

/**
 * Build one fixture. `queued` is DERIVED from the tier rather than stated beside it: the queue is
 * "everything that is not the shelf", and a fixture that disagreed with itself would quietly
 * corrupt the headline recall number.
 */
function fixture(input: FixtureInput): CommFixture {
  const receivedAt = new Date(FIXTURE_NOW.getTime() - (input.minutesAgo ?? 30) * 60 * 1000);
  return {
    id: input.id,
    about: input.about,
    account: input.account,
    message: {
      id: input.id,
      account_id: input.account.id,
      source_id: input.id,
      thread_key: `thread-${input.id}`,
      direction: 'inbound',
      sender_handle: input.from,
      sender_name: input.name,
      chat_name: input.chat?.name,
      participants: input.chat?.participants ?? [],
      subject: input.subject,
      body: input.body,
      received_at: receivedAt.toISOString(),
      body_extracted: true,
      has_attachments: input.attachments ?? false,
      references_ids: [],
      classify_attempts: 0,
      created_at: receivedAt.toISOString(),
    },
    expected: { queued: input.tier !== 'fyi', tier: input.tier },
  };
}

const CARPOOL = { name: 'Soccer carpool', participants: ['+13125550188', '+13125550190'] };
const FAMILY = { name: 'Family', participants: ['+15125550111', '+15125550122'] };

export const FIXTURES: CommFixture[] = [
  fixture({
    id: 'blocked-colleague',
    about: 'Someone is blocked on the owner and says so.',
    account: WORK,
    from: 'dana@northwind.example',
    name: 'Dana Whitfield',
    subject: 'Migration PR',
    body: "I can't ship the release until you approve the migration PR. I'm blocked on it — can you look before the 4pm cut?",
    tier: 'asap',
  }),
  fixture({
    id: 'spouse-call-me',
    about: 'Four words from a priority person that mean drop everything.',
    account: IMESSAGE,
    from: '+15125550111',
    body: 'Call me when you get this',
    tier: 'asap',
  }),
  fixture({
    id: 'spouse-errand',
    about: 'The rubric says anything from Priya is asap unless it is chit-chat.',
    account: IMESSAGE,
    from: '+15125550111',
    body: 'Can you grab milk on the way home? We are out',
    tier: 'asap',
  }),
  fixture({
    id: 'spouse-chitchat',
    about: 'The other half of the same rubric line: chit-chat is still chit-chat.',
    account: IMESSAGE,
    from: '+15125550111',
    body: 'hahaha that dog video',
    tier: 'fyi',
  }),
  fixture({
    id: 'escalation',
    about: 'A named person asking for the owner right now.',
    account: WORK,
    from: 'dana@northwind.example',
    name: 'Dana Whitfield',
    subject: 'Customer call',
    body: 'Fairmount is escalating and asking for you by name. Can you jump on the call now?',
    tier: 'asap',
  }),
  fixture({
    id: 'newsletter-leak',
    about: 'A newsletter with no list headers, so the deterministic filter never saw it.',
    account: PERSONAL,
    from: 'digest@thebriefing.example',
    name: 'The Briefing',
    subject: 'Ten things worth reading this week',
    body: 'Your Monday digest is here. Read on for the ten links our editors picked, plus a note from the team about our new format.',
    tier: 'fyi',
  }),
  fixture({
    id: 'photo-from-priority',
    about: 'A photo with no text from someone who matters — the "sign this" case.',
    account: IMESSAGE,
    from: '+15125550111',
    body: '',
    attachments: true,
    tier: 'today',
  }),
  fixture({
    id: 'photo-from-stranger',
    about: 'The same message from nobody in particular. Most of what a phone carries.',
    account: IMESSAGE,
    from: '+13125559999',
    body: '',
    attachments: true,
    tier: 'fyi',
  }),
  fixture({
    id: 'group-names-owner',
    about: 'A group message that addresses the owner by name.',
    account: IMESSAGE,
    from: '+13125550188',
    name: 'Sam Okafor',
    chat: CARPOOL,
    body: "Alex, can you take Saturday's 9am run? I have a conflict.",
    tier: 'today',
  }),
  fixture({
    id: 'group-chatter',
    about: 'The same chat, saying nothing to anybody in particular.',
    account: IMESSAGE,
    from: '+13125550190',
    chat: CARPOOL,
    body: 'lol the pizza place was closed again',
    tier: 'fyi',
  }),
  fixture({
    id: 'group-open-question',
    about: 'A group question anyone could answer — not an obligation on the owner.',
    account: IMESSAGE,
    from: '+13125550190',
    chat: CARPOOL,
    body: 'Does anyone know if the field is open tomorrow?',
    tier: 'fyi',
  }),
  fixture({
    id: 'group-photo-from-priority',
    about: 'A photo in a group chat from a priority person.',
    account: IMESSAGE,
    from: '+15125550111',
    chat: FAMILY,
    body: '',
    attachments: true,
    tier: 'today',
  }),
  fixture({
    id: 'vendor-invoice',
    about: 'A real obligation with no date pressure.',
    account: WORKMAIL,
    from: 'billing@vendorly.example',
    subject: 'Invoice INV-2231',
    body: 'Attached is invoice INV-2231 for August, due in 30 days. Let us know if anything looks wrong.',
    tier: 'whenever',
  }),
  fixture({
    id: 'vendor-final-notice',
    about: 'A low-priority sender being loud. Owed, but the rubric says never urgent.',
    account: WORKMAIL,
    from: 'trevor@vendorly.example',
    name: 'Trevor Boyd',
    subject: 'FINAL NOTICE: action required today',
    body: 'Our records show invoice INV-2188 is past due. Please confirm payment today to avoid service interruption.',
    tier: 'today',
  }),
  fixture({
    id: 'vendor-sales-pitch',
    about: 'Cold sales mail that asks for a meeting.',
    account: WORKMAIL,
    from: 'growth@pipelinepro.example',
    subject: 'Quick 15 minutes next week?',
    body: 'I noticed Northwind is scaling its delivery team. Do you have 15 minutes on Tuesday to see how we help teams like yours?',
    tier: 'fyi',
  }),
  fixture({
    id: 'fyi-cc',
    about: 'Copied in for visibility, explicitly asking nothing.',
    account: WORK,
    from: 'marcus@northwind.example',
    name: 'Marcus Feld',
    subject: 'Re: platform migration',
    body: 'Adding you to this thread for visibility. No action needed from you — I will handle the rollout notes.',
    tier: 'fyi',
  }),
  fixture({
    id: 'calendar-accept',
    about: 'A calendar notification.',
    account: WORK,
    from: 'calendar-notification@calendar.example',
    subject: 'Accepted: Design sync',
    body: 'Marcus Feld has accepted your invitation. Design sync, Thursday 10:00-10:30.',
    tier: 'fyi',
  }),
  fixture({
    id: 'no-rush-ask',
    about: 'An obligation the sender explicitly un-dated. The whenever case.',
    account: WORK,
    from: 'marcus@northwind.example',
    name: 'Marcus Feld',
    subject: 'Analytics export',
    body: 'No rush at all, but when you get a spare moment could you send me the analytics export for Q2? Any time this month is fine.',
    tier: 'whenever',
  }),
  fixture({
    id: 'scheduling-question',
    about: 'A short question that only the owner can answer.',
    account: WORK,
    from: 'marcus@northwind.example',
    name: 'Marcus Feld',
    subject: 'Vendor call',
    body: 'Does Thursday at 2pm work for the vendor call, or would Friday morning be easier?',
    tier: 'today',
  }),
  fixture({
    id: 'thanks-only',
    about: 'A reply that closes a thread rather than opening one.',
    account: WORK,
    from: 'marcus@northwind.example',
    name: 'Marcus Feld',
    subject: 'Re: analytics export',
    body: 'Thanks, got it. Perfect.',
    tier: 'fyi',
  }),
  fixture({
    id: 'phishing',
    about: 'Manufactured urgency from nobody.',
    account: PERSONAL,
    from: 'security@app1e-billing.example',
    subject: 'Your account will be suspended',
    body: 'We detected a problem with your billing information. Verify your account within 24 hours or it will be permanently suspended. Click here to confirm your details.',
    tier: 'fyi',
  }),
  fixture({
    id: 'shipping-receipt',
    about: 'A transactional receipt.',
    account: PERSONAL,
    from: 'orders@shopfront.example',
    subject: 'Your order #4412 has shipped',
    body: 'Good news — your order is on its way. Estimated delivery Thursday. Track your package with the link below.',
    tier: 'fyi',
  }),
  fixture({
    id: 'school-permission-slip',
    about: 'The rubric names this class of mail explicitly.',
    account: PERSONAL,
    from: 'office@brookfield-school.example',
    subject: 'Field trip permission slip',
    body: 'A reminder that signed permission slips for the science museum trip are due back by tomorrow morning. Please reply to confirm.',
    tier: 'today',
  }),
  fixture({
    id: 'school-newsletter',
    about: 'Same sender, nothing asked. A recall trap in the other direction.',
    account: PERSONAL,
    from: 'office@brookfield-school.example',
    subject: 'September newsletter',
    body: 'Read about the new library wing, our sports results and a message from the principal. No action needed.',
    tier: 'fyi',
  }),
  fixture({
    id: 'boss-before-board-call',
    about: 'A named deadline a few hours out, from someone who matters.',
    account: WORK,
    from: 'dana@northwind.example',
    name: 'Dana Whitfield',
    subject: 'Board call',
    body: 'Can you send me the Q3 delivery numbers before the board call at 4? I present right after the finance slot.',
    tier: 'asap',
  }),
  fixture({
    id: 'recruiter',
    about: 'Mass outreach dressed as a personal note.',
    account: PERSONAL,
    from: 'talent@hiringco.example',
    subject: 'Exciting opportunity',
    body: 'Your background stood out to us and I would love to tell you about a staff engineering role. Are you open to a quick chat this week?',
    tier: 'fyi',
  }),
  fixture({
    id: 'friend-weekend-plan',
    about: 'A social question that still wants an answer.',
    account: IMESSAGE,
    from: '+13125550188',
    name: 'Sam Okafor',
    body: 'You around Sunday for the game? Trying to work out how many chairs to bring',
    tier: 'today',
  }),
  fixture({
    id: 'out-of-office',
    about: 'An automatic reply.',
    account: WORK,
    from: 'kelly@northwind.example',
    subject: 'Automatic reply: Re: rollout plan',
    body: 'I am out of the office until Monday with limited access to email. For anything urgent please contact the delivery desk.',
    tier: 'fyi',
  }),
  fixture({
    id: 'login-code',
    about: 'A one-time code — time-critical and yet nothing is owed to anyone.',
    account: PERSONAL,
    from: 'no-reply@accounts.example',
    subject: 'Your verification code',
    body: 'Your login code is 445 812. It expires in 10 minutes. If you did not request this, ignore this message.',
    tier: 'fyi',
  }),
  fixture({
    id: 'bank-verify-charge',
    about: 'Automated, but genuinely asking the owner a question.',
    account: PERSONAL,
    from: 'alerts@harborbank.example',
    subject: 'Did you make this purchase?',
    body: 'We are checking an unusual charge of $412.09 at Rail Supply Co. Reply YES to approve it or NO to freeze the card.',
    tier: 'today',
  }),
  fixture({
    id: 'contractor-quote',
    about: 'A decision waiting on the owner, with no stated date.',
    account: PERSONAL,
    from: 'mike@bridgeworks-remodel.example',
    subject: 'Kitchen quote',
    body: 'Attached is the quote we discussed. Let me know if you would like to proceed and I will hold a slot in October.',
    tier: 'today',
  }),
  fixture({
    id: 'building-notice',
    about: 'A notice that asks for a confirmation.',
    account: PERSONAL,
    from: 'manager@elmcourt.example',
    subject: 'Water shut-off tomorrow',
    body: 'Water will be off between 8am and noon tomorrow for repairs. Please reply to confirm someone will be home to let the crew in.',
    tier: 'today',
  }),
  fixture({
    id: 'appointment-confirm',
    about: 'A machine asking for a one-word answer.',
    account: PERSONAL,
    from: 'appointments@clearview-dental.example',
    subject: 'Confirm your appointment',
    body: 'You have a cleaning on Thursday at 9:15am. Reply YES to confirm or call us to reschedule.',
    tier: 'today',
  }),
  fixture({
    id: 'appointment-reminder-noreply',
    about: 'Nearly the same message, asking for nothing. The rubric settles it.',
    account: PERSONAL,
    from: 'no-reply@clearview-dental.example',
    subject: 'Reminder: cleaning on the 14th',
    body: 'This is a reminder of your appointment on the 14th at 9:15am. Please do not reply to this message.',
    tier: 'fyi',
  }),
  fixture({
    id: 'family-direct-ask',
    about: 'A group chat where the ask is aimed at the owner.',
    account: IMESSAGE,
    from: '+15125550122',
    chat: FAMILY,
    body: 'Alex can you pick up the cake before 6? The bakery closes early',
    tier: 'today',
  }),
  fixture({
    id: 'review-requested',
    about: 'A developer notification that is a real request.',
    account: WORK,
    from: 'notifications@codehost.example',
    subject: '[northwind/api] Review requested on #412',
    body: 'Dana Whitfield requested your review on pull request #412: "Move billing to the new queue".',
    tier: 'today',
  }),
  fixture({
    id: 'build-failed',
    about: 'An automated alert that implies work but asks no reply.',
    account: WORK,
    from: 'ci@northwind.example',
    subject: 'Build failed on main',
    body: 'The pipeline for main failed at the integration step. Logs are attached to the run.',
    tier: 'today',
  }),
  fixture({
    id: 'wrong-number',
    about: 'A question from a stranger that is not the owner to answer.',
    account: IMESSAGE,
    from: '+19195550143',
    body: 'Hey is this Marco? Are we still on for 7?',
    tier: 'fyi',
  }),
  fixture({
    id: 'delivery-window',
    about: 'A time-stamped notification with nothing asked.',
    account: PERSONAL,
    from: 'tracking@parcelnet.example',
    subject: 'Arriving today between 2 and 4pm',
    body: 'Your package is out for delivery and will arrive today between 2pm and 4pm. No signature required.',
    tier: 'fyi',
  }),
  fixture({
    id: 'reschedule-request',
    about: 'A small ask with a same-day shape.',
    account: WORK,
    from: 'kelly@northwind.example',
    subject: 'Move our 1:1?',
    body: "Can we move tomorrow's 1:1 to 3pm? I have a conflict at the usual time.",
    tier: 'today',
  }),
  fixture({
    id: 'lease-signature',
    about: 'A signature request with a named date.',
    account: PERSONAL,
    from: 'documents@signwell.example',
    subject: 'Please sign: Elm Court lease renewal',
    body: 'Your landlord has sent you a document to sign. Please complete it by Friday.',
    tier: 'today',
  }),
  fixture({
    id: 'accountant-deadline',
    about: 'A real deadline, a week out, from a professional.',
    account: PERSONAL,
    from: 'j.tan@tanbooks.example',
    subject: 'Missing 1099',
    body: "I still need last year's 1099 from you to file on time. Can you dig it out by the 20th? After that we would need an extension.",
    tier: 'today',
  }),
  fixture({
    id: 'subscription-renewal',
    about: 'A billing notice that asks nothing unless the owner objects.',
    account: PERSONAL,
    from: 'billing@streamly.example',
    subject: 'Your plan renews on the 15th',
    body: 'Your annual plan renews on the 15th for $89. No action is needed to continue.',
    tier: 'fyi',
  }),
  fixture({
    id: 'colleague-status-update',
    about: 'A colleague reporting progress and asking for nothing.',
    account: WORK,
    from: 'marcus@northwind.example',
    name: 'Marcus Feld',
    subject: 'Fix deployed',
    body: 'Deployed the fix for the billing timeout this morning. Watching the dashboards, no action needed from you.',
    tier: 'fyi',
  }),
  fixture({
    id: 'interview-availability',
    about: 'An either/or question aimed at the owner.',
    account: WORK,
    from: 'people@northwind.example',
    subject: 'Panel availability',
    body: 'Are you available Tuesday or Wednesday afternoon to sit on the platform panel? I can work around either.',
    tier: 'today',
  }),
  fixture({
    id: 'charity-appeal',
    about: 'A mass appeal that asks for something the owner does not owe.',
    account: PERSONAL,
    from: 'giving@rivertrust.example',
    subject: 'Will you help us reach our goal?',
    body: 'We are $4,000 short of our autumn goal. Would you consider a gift today to help us get there?',
    tier: 'fyi',
  }),
  fixture({
    id: 'neighbour-package',
    about: 'A neighbour offering something and waiting on an answer.',
    account: IMESSAGE,
    from: '+13125550188',
    name: 'Sam Okafor',
    body: 'Your package got left at my door again. Want me to bring it over tonight?',
    tier: 'today',
  }),
  fixture({
    id: 'stale-asap-shaped',
    about: 'Urgent in its wording but three days old — the backlog cap should stop asap.',
    account: WORK,
    from: 'dana@northwind.example',
    name: 'Dana Whitfield',
    subject: 'Need this today',
    body: 'Can you approve the staging deploy today? I am blocked until you do.',
    minutesAgo: 3 * 24 * 60,
    tier: 'today',
  }),

  // The asap tier was the thinnest slice of the set (5 of 48) despite being the one the whole
  // recall-bias design is balanced against — an unearned asap is the credibility cost the module
  // exists to avoid. These five are new, independent scenarios (not derived from watching the
  // model's current answers): a real emergency that outruns the rubric's own same-day floor, a
  // second and differently-shaped Priya case, content severity pulling a normal-priority sender
  // up rather than a named-priority person, and a hard, short deadline rather than an end-of-day
  // one.
  fixture({
    id: 'school-nurse-emergency',
    about:
      "A genuine emergency from the child's school — sharper than the rubric's same-day floor.",
    account: PERSONAL,
    from: 'nurse@brookfield-school.example',
    name: 'Brookfield School Nurse',
    subject: 'Please call the office',
    body: 'This is the school nurse — Jamie has a fever of 103 and is waiting in the office. We need someone to pick them up as soon as possible.',
    tier: 'asap',
  }),
  fixture({
    id: 'spouse-home-emergency',
    about:
      'A second, differently-shaped Priya case: a live problem at home, not an errand or chit-chat.',
    account: IMESSAGE,
    from: '+15125550111',
    body: "The smoke alarm won't stop going off and I can't find the reset. Can you call the alarm company right now?",
    tier: 'asap',
  }),
  fixture({
    id: 'prod-outage-bridge',
    about:
      'A normal-priority colleague, but the content — a live outage — is what earns asap here.',
    account: WORK,
    from: 'marcus@northwind.example',
    name: 'Marcus Feld',
    subject: 'Payments down',
    body: 'We have a full outage on the payments service and customers are failing at checkout. Need you on the incident bridge right now.',
    tier: 'asap',
  }),
  fixture({
    id: 'neighbour-fall',
    about: 'A low-stakes sender in every other fixture, but a real injury changes that.',
    account: IMESSAGE,
    from: '+13125550188',
    name: 'Sam Okafor',
    body: "I just fell off the ladder cleaning gutters and my ankle doesn't feel right. Can you come over or call someone now?",
    tier: 'asap',
  }),
  fixture({
    id: 'closing-wire-deadline',
    about:
      'A hard deadline measured in minutes, not the end of the day like the other signature fixtures.',
    account: PERSONAL,
    from: 'j.marsh@fieldstonetitle.example',
    name: 'Jordan Marsh',
    subject: 'Closing in 20 minutes',
    body: "We're still on for the 2pm closing but need your signature on the wire instructions in the next 20 minutes or we lose today's rate lock.",
    tier: 'asap',
  }),
];
