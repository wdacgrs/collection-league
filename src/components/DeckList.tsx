"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsonFetch, type CatalogCard, type CollectionCard, type DeckSummary } from "@/lib/client";
import { commanderCandidates } from "@/lib/commander-selection";
import { deckBanner } from "@/lib/deck-banner";
import { parseCommanderNames, resolveCommanderIdentity } from "@/lib/deck-identity";

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
  const [cmdQuery, setCmdQuery] = useState("");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [partnerQuery, setPartnerQuery] = useState("");
  const [partnerOpen, setPartnerOpen] = useState(false);
  const deleteTriggers = useRef(new Map<string, HTMLButtonElement>());
  const load = useCallback(() => jsonFetch<Data>(`/api/profiles/${profileId}`).then(setData).catch((cause) => setError(cause.message)), [profileId]);
  useEffect(() => { void load(); }, [load]);
  // The catalog carries card types, needed to find legendary creatures. Cached for an hour by the API.
  useEffect(() => { jsonFetch<CatalogCard[]>("/api/catalog").then(setCatalog).catch((cause) => setError(cause.message)); }, []);

  // Legendary creatures this player owns; the only cards offered as commanders.
  const candidates = useMemo(() => (data ? commanderCandidates(data.cards, catalog) : []), [data, catalog]);

  // Banner per deck from its commanders' color identity. Waits for the catalog
  // so decks don't flash the colorless banner while identities are unknown.
  const banners = useMemo(() => {
    const out = new Map<string, ReturnType<typeof deckBanner>>();
    if (!data || catalog.length === 0) return out;
    for (const deck of data.decks) {
      out.set(deck.id, deckBanner(resolveCommanderIdentity(parseCommanderNames(deck.commander), catalog)));
    }
    return out;
  }, [data, catalog]);

  function chooseCommander(name: string) {
    setCommander(name); setCmdQuery(name); setCmdOpen(false);
    if (!name || name === partner) { setPartner(""); setPartnerQuery(""); }
  }

  function choosePartner(name: string) { setPartner(name); setPartnerQuery(name); setPartnerOpen(false); }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const form = new FormData(event.currentTarget); const formEl = event.currentTarget;
    const commanders = [commander, partner].filter(Boolean);
    try {
      await jsonFetch(`/api/profiles/${profileId}/decks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), commanders }) });
      formEl.reset(); setCommander(""); setPartner(""); setCmdQuery(""); setPartnerQuery(""); setCmdOpen(false); setPartnerOpen(false); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create deck."); }
  }
  function closeConfirm(id: string) { setConfirmId(null); window.requestAnimationFrame(() => deleteTriggers.current.get(id)?.focus()); }
  async function remove(deckId: string) { closeConfirm(deckId); try { await jsonFetch(`/api/profiles/${profileId}/decks/${deckId}`, { method: "DELETE" }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete deck."); } }

  if (!data) return <main className="shell"><p className="muted">{error || "Loading decks…"}</p></main>;
  const noCandidates = catalog.length > 0 && candidates.length === 0;
  const hint = catalog.length === 0
    ? "Loading commanders…"
    : noCandidates
      ? `No legendary creatures in ${data.profile.name}'s collection yet. You can still create a deck without a commander.`
      : `Choose up to 2 different legendary creatures from ${data.profile.name}'s collection.`;
  const cmdMatches = candidates.filter((name) => !cmdQuery || name.toLowerCase().includes(cmdQuery.toLowerCase()));
  const partnerMatches = candidates.filter((name) => name !== commander && (!partnerQuery || name.toLowerCase().includes(partnerQuery.toLowerCase())));
  return <main className="shell decks-page">
    <header className="page-heading"><div><Link className="back-link" href={`/p/${profileId}`}>← {data.profile.name}'s collection</Link><div className="eyebrow">Deck workshop</div><h1>{data.profile.name}'s decks</h1></div><span>{data.decks.length} total</span></header>
    <form className="deck-create" onSubmit={create}>
      <label>Deck name<input name="name" required placeholder="New deck" /></label>
      <label>Commander (optional)
        <div className="cmd-search">
          <input type="text" value={cmdQuery} onChange={(e) => { setCmdQuery(e.target.value); setCommander(""); setCmdOpen(true); }} onFocus={() => setCmdOpen(true)} onBlur={() => setTimeout(() => setCmdOpen(false), 150)} placeholder={catalog.length === 0 ? "Loading…" : "Search legendary creatures…"} autoComplete="off" disabled={!candidates.length && catalog.length > 0} aria-describedby="commander-hint" />
          {cmdOpen && candidates.length > 0 && <ul className="cmd-dropdown"><li onMouseDown={() => chooseCommander("")}>— No commander</li>{cmdMatches.map((name) => <li key={name} onMouseDown={() => chooseCommander(name)}>{name}</li>)}</ul>}
        </div>
      </label>
      <label>Second commander (optional)
        <div className="cmd-search">
          <input type="text" value={partnerQuery} onChange={(e) => { setPartnerQuery(e.target.value); setPartner(""); setPartnerOpen(true); }} onFocus={() => setPartnerOpen(true)} onBlur={() => setTimeout(() => setPartnerOpen(false), 150)} placeholder="Search second commander…" autoComplete="off" disabled={!commander} aria-describedby="commander-hint" />
          {partnerOpen && commander && <ul className="cmd-dropdown"><li onMouseDown={() => choosePartner("")}>— No second commander</li>{partnerMatches.map((name) => <li key={name} onMouseDown={() => choosePartner(name)}>{name}</li>)}</ul>}
        </div>
      </label>
      <button className="primary" type="submit">Create deck</button>
      <p id="commander-hint" className="field-hint">{hint}</p>
    </form>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <section className="deck-list">{data.decks.length === 0 ? <div className="empty"><h2>No decks yet</h2><p>Create one above, then add cards from this collection.</p></div> : data.decks.map((deck) => { const banner = banners.get(deck.id); return <article className={banner ? "deck-row has-banner" : "deck-row"} key={deck.id}><div><h2>{deck.name}</h2><p>{commanderLabel(deck.commander)}</p></div>{banner && <div className="deck-banner" style={{ background: banner.background }} role="img" aria-label={banner.label} title={banner.label} />}<span>{deck.cardCount} card entries</span><Link className="button-link" href={`/p/${profileId}/decks/${deck.id}`}>Edit</Link>{confirmId === deck.id ? <div className="inline-confirm"><span>Delete {deck.name}?</span><button className="danger" type="button" onClick={() => void remove(deck.id)}>Confirm</button><button type="button" onClick={() => closeConfirm(deck.id)}>Cancel</button></div> : <button ref={(node) => { if (node) deleteTriggers.current.set(deck.id, node); else deleteTriggers.current.delete(deck.id); }} className="danger-ghost" type="button" onClick={() => setConfirmId(deck.id)}>Delete</button>}</article>; })}</section>
  </main>;
}
