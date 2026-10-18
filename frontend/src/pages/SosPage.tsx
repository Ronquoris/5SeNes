import { useEffect, useState } from 'react';
import { TrustedContactsManager } from '../components/TrustedContactsManager';
import { SosButton } from '../components/SosButton';
import { speechQueue } from '../speech/SpeechQueue';

export function SosPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <TrustedContactsManager selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
      <SosButton selectedContactIds={selectedIds} />
    </div>
  );
}
