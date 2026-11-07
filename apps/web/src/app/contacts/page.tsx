'use client';

import { ContactsScreen } from '@/components/contacts/ContactsScreen';
import { ComingSoon } from '@/components/shell/ComingSoon';
import { FLAGS } from '@/lib/flags/features';
import { useT } from '@/lib/i18n/provider';

/** Local-first contact book (Monday sprint E1). Kill switch: NEXT_PUBLIC_TAPLY_FLAG_CONTACTS=off. */
export default function Page() {
  const t = useT();
  if (!FLAGS.contacts.enabled) {
    return <ComingSoon title={t.screens.contacts} summary={t.routes.contacts} flag="contacts" icon="wallet" />;
  }
  return <ContactsScreen />;
}
