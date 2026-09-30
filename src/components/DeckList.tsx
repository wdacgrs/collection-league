"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsonFetch, type CatalogCard, type CollectionCard, type DeckSummary } from "@/lib/client";
import { commanderCandidates } from "@/lib/commander-selection";
import { parseCommanderNames } from "@/lib/deck-identity";

type Data = { profile: { name: string }; cards: CollectionCard[]; decks: DeckSummary[] };

function commanderLabel(stored: string | null) {
  const names = parseCommanderNames(stored);
  if (!names.length) return "No commander selected";
  return `${names.length > 1 ? "Commanders" : "Commander"}: ${names.join(" & ")}`;
}

export function DeckList({ profileId }: { profileId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [catalog, setCatalog] = useState<CatalogCard[]>([]);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [commander, setCommander] = useState("");
  const [partner, setPartner] = useState("");
  const deleteTriggers = useRef(new Map<string, HTMLButtonElement>());
  const load = useCallback(() => jsonFetch<Data>(`/api/profiles/${profileId}`).then(setData).catch((cause) => setError(cause.message)), [profileId]);
  useEffect(() => { void load(); }, [load]);
  // The catalog carries card types, needed to find legendary creatures. Cached for an hour by the API.
  useEffect(() => { jsonFetch<CatalogCard[]>("/api/catalog").then(setCatalog).catch((cause) => setError(cause.message)); }, []);

  // Legendary creatures this player owns; the only cards offered as commanders.
  const candidates = useMemo(() => (data ? commanderCandidates(data.cards, catalog) : []), [data, catalog]);

  function chooseCommander(name: string) {
    setCommander(name);
    // A second commander needs a first one, and the two must differ.
    if (!name || name === partner) setPartner("");
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const form = new FormData(event.currentTarget); const formEl = event.currentTarget;
    const commanders = [commander, partner].filter(Boolean);
    try {
      await jsonFetch(`/api/profiles/${profileId}/decks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), commanders }) });
      formEl.reset(); setCommander(""); setPartner(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create deck."); }
  }
  function closeConfirm(id: string) { setConfirmId(null); window.requestAnimationFrame(() => deleteTriggers.current.get(id)?.focus()); }
  async function remove(deckId: string) { closeConfirm(deckId); try { await jsonFetch(`/api/profiles/${profileId}/decks/${deckId}`, { method: "DELETE" }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete deck."); } }

  if (!data) return <main className="shell"><p className="muted">{error || "Loading decks…"}</p></main>;
  const noCandidates = catalog.length > 0 && candidates.length === 0;
  const hint = catalog.length === 0
    ? "Loading commanders…"
    : noCandidates
      ? `No legendary creatures in ${data.profile.name}’s collection yet. You can still create a deck without a commander.`
      : `Choose up to 2 different legendary creatures from ${data.profile.name}’s collection.`;
  return <main className="shell decks-page">
    <header className="page-heading"><div><Link className="back-link" href={`/p/${profileId}`}>← {data.profile.name}’s collection</Link><div className="eyebrow">Deck workshop</div><h1>{data.profile.name}’s decks</h1></div><span>{data.decks.length} total</span></header>
    <form className="deck-create" onSubmit={create}>
      <label>Deck name<input name="name" required placeholder="New deck" /></label>
      <label>Commander (optional)
        <select id="deck-commander" value={commander} onChange={(event) => chooseCommander(event.target.value)} disabled={!candidates.length} aria-describedby="commander-hint">
          <option value="">No commander</option>
          {candidates.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label>Second commander (optional)
        <select id="deck-commander-2" value={partner} onChange={(event) => setPartner(event.target.value)} disabled={!commander} aria-describedby="commander-hint">
          <option value="">No second commander</option>
          {candidates.filter((name) => name !== commander).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <button className="primary" type="submit">Create deck</button>
      <p id="commander-hint" className="field-hint">{hint}</p>
    </form>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <section className="deck-list">{data.decks.length === 0 ? <div className="empty"><h2>No decks yet</h2><p>Create one above, then add cards from this collection.</p></div> : data.decks.map((deck) => <article className="deck-row" key={deck.id}><div><h2>{deck.name}</h2><p>{commanderLabel(deck.commander)}</p></div><span>{deck.cardCount} card entries</span><Link className="button-link" href={`/p/${profileId}/decks/${deck.id}`}>Edit</Link>{confirmId === deck.id ? <div className="inline-confirm"><span>Delete {deck.name}?</span><button className="danger" type="button" onClick={() => void remove(deck.id)}>Confirm</button><button type="button" onClick={() => closeConfirm(deck.id)}>Cancel</button></div> : <button ref={(node) => { if (node) deleteTriggers.current.set(deck.id, node); else deleteTriggers.current.delete(deck.id); }} className="danger-ghost" type="button" onClick={() => setConfirmId(deck.id)}>Delete</button>}</article>)}</section>
  </main>;
}
