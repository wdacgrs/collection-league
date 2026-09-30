"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { jsonFetch, type DeckSummary } from "@/lib/client";
import { MatchList, type MatchRecord } from "./MatchList";

type Profile = { id: string; name: string };

export function MatchesDashboard() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [winnerId, setWinnerId] = useState("");
  const [loserId, setLoserId] = useState("");
  const [winnerDecks, setWinnerDecks] = useState<DeckSummary[]>([]);
  const [loserDecks, setLoserDecks] = useState<DeckSummary[]>([]);
  const [error, setError] = useState("");
  const loadMatches = useCallback(async () => { const data = await jsonFetch<{ matches: MatchRecord[] }>("/api/matches"); setMatches(data.matches); }, []);
  useEffect(() => { Promise.all([jsonFetch<{ profiles: Profile[] }>("/api/profiles?counts=0"), loadMatches()]).then(([data]) => setProfiles(data.profiles)).catch((cause) => setError(cause.message)); }, [loadMatches]);
  useEffect(() => { if (!winnerId) { setWinnerDecks([]); return; } jsonFetch<{ decks: DeckSummary[] }>(`/api/profiles/${winnerId}/decks`).then((data) => setWinnerDecks(data.decks)).catch((cause) => setError(cause.message)); }, [winnerId]);
  useEffect(() => { if (!loserId) { setLoserDecks([]); return; } jsonFetch<{ decks: DeckSummary[] }>(`/api/profiles/${loserId}/decks`).then((data) => setLoserDecks(data.decks)).catch((cause) => setError(cause.message)); }, [loserId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const form = new FormData(event.currentTarget); const formElement = event.currentTarget;
    try { await jsonFetch("/api/matches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ winnerId, loserId, winnerDeckId: form.get("winnerDeckId") || null, loserDeckId: form.get("loserDeckId") || null, note: form.get("note") || null }) }); formElement.reset(); setWinnerId(""); setLoserId(""); await loadMatches(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record match."); }
  }

  return <main className="shell matches-page"><header className="page-heading"><div><Link className="back-link" href="/">← Players</Link><div className="eyebrow">League play</div><h1>Matches</h1></div><span>{matches.length} recent</span></header>
    <section className="data-section"><h2>Record a match</h2>{profiles.length < 2 ? <p className="notice">Create at least two players before recording a match.</p> : <form className="match-form" onSubmit={submit}><label>Winner<select required value={winnerId} onChange={(event) => setWinnerId(event.target.value)}><option value="">Select winner</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label><label>Winner deck<select name="winnerDeckId" defaultValue="" key={winnerId}><option value="">No deck</option>{winnerDecks.map((deck) => <option value={deck.id} key={deck.id}>{deck.name}</option>)}</select></label><span className="versus">VS</span><label>Loser<select required value={loserId} onChange={(event) => setLoserId(event.target.value)}><option value="">Select loser</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label><label>Loser deck<select name="loserDeckId" defaultValue="" key={loserId}><option value="">No deck</option>{loserDecks.map((deck) => <option value={deck.id} key={deck.id}>{deck.name}</option>)}</select></label><label className="match-note">Note (optional)<input name="note" maxLength={200} placeholder="A close game…" /></label><button className="primary" type="submit" disabled={!winnerId || !loserId || winnerId === loserId}>Record match</button></form>}{error && <p className="error-banner">{error}</p>}</section>
    <section className="data-section"><h2>Recent matches</h2><MatchList matches={matches} onDeleted={loadMatches} /></section></main>;
}
