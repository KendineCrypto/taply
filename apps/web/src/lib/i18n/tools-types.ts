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
}
