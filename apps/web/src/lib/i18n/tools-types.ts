import type { ErrorCopy } from './types';

/** Monday sprint (E1-E3): Contacts, recurring request templates, Split Pay. */
export interface ToolsCopy {
  readonly contacts: {
    readonly title: string;
    readonly description: string;
    readonly localOnly: string;
    readonly count: string;
    readonly searchLabel: string;
    readonly searchPlaceholder: string;
    readonly add: string;
    readonly addTitle: string;
    readonly editTitle: string;
    readonly labelField: string;
    readonly labelHint: string;
    readonly accountField: string;
    readonly accountHint: string;
    readonly save: string;
    readonly cancel: string;
    readonly edit: string;
    readonly delete: string;
    readonly deleteTitle: string;
    readonly deleteBody: string;
    readonly deleteConfirm: string;
    readonly empty: ErrorCopy;
    readonly noMatches: string;
    readonly unavailable: ErrorCopy;
    readonly corrupt: ErrorCopy;
    readonly resetAll: string;
    readonly resetTitle: string;
    readonly resetBody: string;
    readonly resetConfirm: string;
    readonly errors: Readonly<
      Record<
        | 'label_empty'
        | 'label_too_long'
        | 'label_hidden_characters'
        | 'account_empty'
        | 'account_invalid'
        | 'account_mainnet'
        | 'duplicate_account'
        | 'duplicate_label'
        | 'limit'
        | 'save_failed'
        | 'unreadable'
        | 'not_found',
        string
      >
    >;
    readonly similarTitle: string;
    readonly similarBody: string;
    readonly similarReason: Readonly<Record<'looks_alike' | 'one_character' | 'same_start_and_end', string>>;
    readonly similarConfirm: string;
    readonly accountChanged: string;
    readonly accountChangedConfirm: string;
    readonly saved: string;
    readonly deleted: string;
    readonly pickerOpen: string;
    readonly pickerTitle: string;
    readonly pickerDescription: string;
    readonly pickerEmpty: string;
    readonly manage: string;
    readonly fromContact: string;
    readonly notThisContact: string;
    readonly saveAsContact: string;
    readonly updatedOn: string;
  };
  readonly recurring: {
    readonly title: string;
    readonly description: string;
    readonly notSubscription: string;
    readonly add: string;
    readonly addTitle: string;
    readonly editTitle: string;
    readonly nameField: string;
    readonly amountField: string;
    readonly memoField: string;
    readonly payerField: string;
    readonly payerHint: string;
    readonly cadenceField: string;
    readonly cadence: Readonly<Record<'weekly' | 'monthly', string>>;
    readonly startField: string;
    readonly startHint: string;
    readonly endField: string;
    readonly endHint: string;
    readonly timeZone: string;
    readonly save: string;
    readonly cancel: string;
    readonly edit: string;
    readonly delete: string;
    readonly deleteTitle: string;
    readonly deleteBody: string;
    readonly deleteConfirm: string;
    readonly stop: string;
    readonly resume: string;
    readonly stopped: string;
    readonly empty: ErrorCopy;
    readonly unavailable: ErrorCopy;
    readonly corrupt: ErrorCopy;
    readonly due: string;
    readonly upcoming: string;
    readonly created: string;
    readonly none: string;
    readonly prepare: string;
    readonly prepareNote: string;
    readonly openRequest: string;
    readonly nextDates: string;
    readonly toYou: string;
    readonly onlyPayer: string;
    readonly anyPayer: string;
    readonly connectFirst: string;
    readonly otherAccount: string;
    readonly saved: string;
    readonly errors: Readonly<
      Record<
        | 'name_empty'
        | 'name_too_long'
        | 'name_hidden_characters'
        | 'amount_required'
        | 'amount_invalid'
        | 'amount_zero'
        | 'memo_too_long'
        | 'payer_invalid'
        | 'payer_is_recipient'
        | 'start_invalid'
        | 'end_invalid'
        | 'end_before_start'
        | 'recipient_invalid'
        | 'save_failed',
        string
      >
    >;
  };
  readonly split: {
    readonly title: string;
    readonly description: string;
    readonly howItWorks: string;
    readonly add: string;
    readonly addTitle: string;
    readonly nameField: string;
    readonly totalField: string;
    readonly memoField: string;
    readonly modeField: string;
    readonly personLabel: string;
    readonly personAccount: string;
    readonly personAccountHint: string;
    readonly personShare: string;
    readonly addPerson: string;
    readonly removePerson: string;
    readonly previewTitle: string;
    readonly sumOk: string;
    readonly sumOff: string;
    readonly save: string;
    readonly cancel: string;
    readonly delete: string;
    readonly deleteTitle: string;
    readonly deleteBody: string;
    readonly deleteConfirm: string;
    readonly locked: string;
    readonly prepare: string;
    readonly prepareNote: string;
    readonly signingOff: string;
    readonly checkStatus: string;
    readonly checking: string;
    readonly verify: string;
    readonly verifying: string;
    readonly verifiedNote: string;
    readonly openRequest: string;
    readonly anyPayer: string;
    readonly onlyPayer: string;
    readonly toYou: string;
    readonly connectFirst: string;
    readonly otherAccount: string;
    readonly saved: string;
    readonly verifiedOf: string;
    readonly notVerifiedSession: string;
    readonly howItWorksTitle: string;
    readonly exactTitle: string;
    readonly exactNote: string;
    readonly mode: Readonly<Record<'equal' | 'custom', string>>;
    readonly empty: ErrorCopy;
    readonly unavailable: ErrorCopy;
    readonly corrupt: ErrorCopy;
    readonly child: Readonly<Record<'not_created' | 'checking' | 'unknown' | 'open' | 'expired' | 'in_flight' | 'payout_failed' | 'cancelled' | 'paid_per_contract' | 'verified' | 'mismatch', string>>;
    readonly group: Readonly<Record<'preparing' | 'waiting' | 'partial' | 'needs_attention' | 'paid_unverified' | 'settled_verified', ErrorCopy>>;
    readonly errors: Readonly<Record<'name_empty' | 'name_too_long' | 'name_hidden_characters' | 'total_required' | 'total_invalid' | 'total_zero' | 'too_few_people' | 'too_many_people' | 'person_label_invalid' | 'person_account_invalid' | 'person_is_recipient' | 'duplicate_person_account' | 'share_invalid' | 'share_zero' | 'shares_do_not_add_up' | 'memo_too_long' | 'recipient_invalid' | 'save_failed', string>>;
  };
  /** Banner on /request/new when a planning tool pre-filled the form. */
  readonly prefill: {
    readonly recurring: string;
    readonly split: string;
    readonly note: string;
    readonly recorded: string;
  };
}
