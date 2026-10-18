import { FormEvent, useEffect, useState } from 'react';
import { createContact, deleteContact, fetchContacts, type TrustedContact } from '../api/client';
import { speechQueue } from '../speech/SpeechQueue';

interface TrustedContactsManagerProps {
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function TrustedContactsManager({ selectedIds, onSelectionChange }: TrustedContactsManagerProps) {
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const { contacts } = await fetchContacts();
      setContacts(contacts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load contacts.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await createContact({ name: name.trim(), relationship: relationship.trim() || undefined, phone: phone.trim() || undefined });
      setName('');
      setRelationship('');
      setPhone('');
      speechQueue.speak(`${name} added as a trusted contact.`, 'INFO');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add contact.');
    }
  }

  async function handleRemove(contact: TrustedContact) {
    try {
      await deleteContact(contact.id);
      onSelectionChange(selectedIds.filter((id) => id !== contact.id));
      speechQueue.speak(`${contact.name} removed.`, 'INFO');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove contact.');
    }
  }

  function toggleSelected(id: string) {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((x) => x !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  }

  return (
    <div className="card">
      <h2>Trusted contacts</h2>
      <p className="muted">Pick who should see your live location when you start an SOS.</p>

      {error && <p className="error-text">{error}</p>}

      <ul className="list-unstyled" aria-label="Trusted contacts">
        {contacts.map((contact) => (
          <li key={contact.id} className="list-item">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 400 }}>
              <input type="checkbox" checked={selectedIds.includes(contact.id)} onChange={() => toggleSelected(contact.id)} />
              <span>
                <strong>{contact.name}</strong>
                {contact.relationship ? ` — ${contact.relationship}` : ''}
                {contact.phone ? ` · ${contact.phone}` : ''}
              </span>
            </label>
            <button type="button" className="btn secondary" style={{ marginTop: '0.4rem' }} onClick={() => handleRemove(contact)}>
              Remove
            </button>
          </li>
        ))}
        {contacts.length === 0 && <p className="muted">No trusted contacts yet — add one below.</p>}
      </ul>

      <form onSubmit={handleAdd} style={{ marginTop: '1rem' }}>
        <div className="field">
          <label htmlFor="contact-name">Name</label>
          <input id="contact-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="contact-relationship">Relationship (optional)</label>
          <input id="contact-relationship" type="text" value={relationship} onChange={(e) => setRelationship(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="contact-phone">Phone (optional)</label>
          <input id="contact-phone" type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <button type="submit" className="btn">
          Add contact
        </button>
      </form>
    </div>
  );
}
