"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CardImage } from "./CardImage";
import { jsonFetch, type CatalogCard, type CollectionCard, type DeckCard } from "@/lib/client";
import { commanderCandidates } from "@/lib/commander-selection";
import { BASIC_LANDS_GROUP, buildPoolGroups } from "@/lib/deck-pool";
import {
  MAX_COMMANDERS,
  parseCommanderNames,
  toggleCommander,
  isCommander as isCommanderName,
  resolveCommanderIdentity,
  isLegal as isLegalIdentity,
  isOutOfIdentity as isOutOfIdentityCard,
} from "@/lib/deck-identity";

type ProfileData = { profile: { name: string }; cards: CollectionCard[] };
type DeckData = { deck: { id: string; name: string; commander: string | null }; cards: DeckCard[] };
type ViewMode = "images" | "list";
const VIEW_STORAGE_KEY = "fra-deck-view";
const COLLAPSED_STORAGE_KEY = "fra-deck-collapsed";
const BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
const isBasicName = (name: string) => BASICS.some((basic) => basic.toLowerCase() === name.toLowerCase());

/**
 * Commander button state for a card:
 * - active: one of the deck's commanders (click to remove);
 * - available: an owned legendary creature that can be added;
 * - full: eligible, but 2 commanders are already chosen;
 * - none: not eligible (not an owned legendary creature), so no button.
 */
type StarState = "active" | "available" | "full" | "none";

function CommanderStar({ name, state, onToggle }: { name: string; state: StarState; onToggle: () => void }) {
  if (state === "none") return null;
  const label = state === "active" ? `Remove ${name} as commander` : `Set ${name} as commander`;
  return <button type="button" className={`commander-star ${state === "active" ? "active" : ""}`} onClick={onToggle} disabled={state === "full"} aria-label={label} aria-pressed={state === "active"} title={state === "full" ? `${MAX_COMMANDERS} commanders already chosen` : label}>★</button>;
}

function GalleryCard({ name, catalog, qty, owned, cap, star, onQty, onCommander, imageAdds = false, outOfIdentity = false }: { name: string; catalog?: CatalogCard; qty: number; owned?: number; cap: number; star: StarState; onQty: (qty: number) => void; onCommander: () => void; imageAdds?: boolean; outOfIdentity?: boolean }) {
  // Out-of-identity cards cannot be increased (Req 7.4); decrease stays enabled (Req 7.3).
  const capped = qty >= cap || outOfIdentity;
  return <article className={`deck-card-tile card-tile ${star === "active" ? "is-commander" : ""} ${capped && imageAdds ? "at-cap" : ""} ${outOfIdentity ? "out-of-identity" : ""}`} tabIndex={0}>
    <div className="deck-card-visual">
      <CardImage name={name} catalog={catalog} dimmed={(owned !== undefined && owned <= 0) || outOfIdentity} onClick={imageAdds && !capped ? () => onQty(qty + 1) : undefined} ariaLabel={imageAdds ? `Add ${name} to deck` : undefined} />
      {qty > 0 && <span className="deck-qty-badge" aria-label={`${qty} in deck`}>{qty}</span>}
      {outOfIdentity && <span className="off-color-badge" title="Outside commander color identity" aria-label={`${name} is outside the commander color identity`}>⚠</span>}
      <div className="deck-card-overlay"><span>{qty} in deck{owned !== undefined ? ` · ${owned} owned` : ""}{outOfIdentity ? " · off-color" : ""}</span><div className="deck-card-actions">
        <div className="mini-stepper"><button type="button" onClick={() => onQty(Math.max(0, qty - 1))} disabled={qty === 0} aria-label={`Decrease ${name}`}>−</button><b>{qty}</b><button type="button" onClick={() => onQty(qty + 1)} disabled={capped} aria-label={`Increase ${name}`}>+</button></div>
        <CommanderStar name={name} state={star} onToggle={onCommander} />
      </div></div>
    </div>
    <div className="card-meta"><strong title={name}>{name}</strong>{catalog && <span className={`rarity-gem rarity-${catalog.rarity.toLowerCase()}`}>{catalog.rarity}</span>}</div>
  </article>;
}

/** A collapsible pool group. The header is a real button with aria-expanded. */
function PoolGroupSection({ title, count, collapsed, onToggle, className = "", children }: { title: string; count: string; collapsed: boolean; onToggle: () => void; className?: string; children: ReactNode }) {
  const bodyId = `pool-group-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return <section className={`pool-section ${collapsed ? "collapsed" : ""} ${className}`}>
    <h3><button type="button" className="group-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={onToggle}><span className="group-chevron" aria-hidden="true">{collapsed ? "▸" : "▾"}</span><span className="group-name">{title}</span><small>{count}</small></button></h3>
    <div id={bodyId} hidden={collapsed}>{children}</div>
  </section>;
}

export function DeckEditor({ profileId, deckId }: { profileId: string; deckId: string }) {
  const [profile, setProfile] = useState<ProfileData | null>(null); const [deck, setDeck] = useState<DeckData | null>(null); const [catalog, setCatalog] = useState<CatalogCard[]>([]); const [search, setSearch] = useState(""); const [status, setStatus] = useState(""); const [error, setError] = useState(""); const [viewMode, setViewMode] = useState<ViewMode>("images"); const saves = useRef(0);
  // Collapsed pool groups (persisted), and whether off-color cards are shown.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showOffColor, setShowOffColor] = useState(false);
  // The sticky workspace header's real height (it wraps on narrow screens), exposed as
  // --workspace-header-h so the sticky deck panel and pool toolbar sit right below it.
  const editorRef = useRef<HTMLElement | null>(null);
  const loaded = Boolean(profile && deck);
  useEffect(() => {
    const root = editorRef.current;
    const header = root?.querySelector<HTMLElement>(".workspace-header");
    if (!root || !header || typeof ResizeObserver === "undefined") return;
    const update = () => root.style.setProperty("--workspace-header-h", `${header.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, [loaded]);
  const load = useCallback(async () => { try { const [p, d, c] = await Promise.all([jsonFetch<ProfileData>(`/api/profiles/${profileId}`), jsonFetch<DeckData>(`/api/profiles/${profileId}/decks/${deckId}`), jsonFetch<CatalogCard[]>("/api/catalog")]); setProfile(p); setDeck(d); setCatalog(c); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load deck."); } }, [profileId, deckId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "images" || stored === "list") setViewMode(stored);
      const groups = JSON.parse(window.localStorage.getItem(COLLAPSED_STORAGE_KEY) || "[]");
      if (Array.isArray(groups)) setCollapsed(new Set(groups.filter((g): g is string => typeof g === "string")));
    } catch { /* localStorage may be unavailable (privacy mode/SSR) or hold bad JSON. */ }
  }, []);
  const catalogMap = useMemo(() => new Map(catalog.map((card) => [card.name.toLowerCase(), card])), [catalog]);
  const deckMap = useMemo(() => new Map((deck?.cards || []).map((card) => [card.name.toLowerCase(), card])), [deck]);
  // Selected commander name(s), 0–2 entries decoded from the single stored string.
  const commanderNames = useMemo(() => parseCommanderNames(deck?.deck.commander), [deck?.deck.commander]);
  // Union of the parsed identities of the selected commanders; undefined when none.
  const commanderIdentity = useMemo(
    () => resolveCommanderIdentity(commanderNames, catalog),
    [commanderNames, catalog],
  );
  // Owned legendary creatures: the only cards that may be made commander (same rule as deck creation).
  const eligibleCommanders = useMemo(
    () => new Set(commanderCandidates(profile?.cards ?? [], catalog).map((name) => name.toLowerCase())),
    [profile, catalog],
  );
  // A card is legal to show/add when unfiltered, a basic land, or a subset match.
  const isLegalCard = useCallback(
    (name: string, isBasic: boolean) => {
      const card = catalogMap.get(name.toLowerCase());
      return isLegalIdentity(card ?? { name, colorIdentity: "" }, commanderIdentity, isBasic);
    },
    [catalogMap, commanderIdentity],
  );
  // A deck card is out-of-identity (marked, increase blocked) per Req 7.
  const isCardOutOfIdentity = useCallback(
    (name: string, isBasic: boolean) => {
      const card = catalogMap.get(name.toLowerCase());
      return isOutOfIdentityCard(card ?? { name, colorIdentity: "" }, commanderIdentity, isBasic);
    },
    [catalogMap, commanderIdentity],
  );

  async function saveDeck(patch: { name?: string; commander?: string | null }) {
    if (!deck) return; setDeck({ ...deck, deck: { ...deck.deck, ...patch } }); setStatus("Saving…"); setError("");
    // On failure (e.g. a commander the server rejects) reload to undo the optimistic update.
    try { await jsonFetch(`/api/profiles/${profileId}/decks/${deckId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }); setStatus("Saved"); } catch (cause) { setStatus(""); setError(cause instanceof Error ? cause.message : "Save failed."); await load(); }
  }
  async function saveCard(name: string, qty: number) {
    if (!deck) return; const current = deckMap.get(name.toLowerCase());
    const nextCards = qty === 0 ? deck.cards.filter((card) => card.name.toLowerCase() !== name.toLowerCase()) : current ? deck.cards.map((card) => card.name.toLowerCase() === name.toLowerCase() ? { ...card, qty } : card) : [...deck.cards, { id: `temp-${name}`, deckId, name, qty, isBasic: isBasicName(name) }];
    setDeck({ ...deck, cards: nextCards }); saves.current += 1; setStatus("Saving…"); setError("");
    try { await jsonFetch(`/api/profiles/${profileId}/decks/${deckId}/cards`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, qty }) }); setStatus("Saved"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed."); await load(); } finally { saves.current -= 1; if (saves.current > 0) setStatus("Saving…"); }
  }
  function rename(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void saveDeck({ name: String(new FormData(event.currentTarget).get("name") || "") }); }
  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, mode); } catch { /* Keep the in-memory preference. */ }
  }
  function storeCollapsed(next: Set<string>) {
    setCollapsed(next);
    try { window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next])); } catch { /* Keep the in-memory state. */ }
  }
  function toggleGroup(group: string) {
    const next = new Set(collapsed);
    if (next.has(group)) next.delete(group); else next.add(group);
    storeCollapsed(next);
  }

  if (!profile || !deck) return <main className="shell"><p className="muted">{error || "Loading deck…"}</p></main>;
  const owned = profile.cards.filter((card) => card.owned).sort((a, b) => a.name.localeCompare(b.name)); const ownedMap = new Map(owned.map((card) => [card.name.toLowerCase(), card]));
  const total = deck.cards.reduce((sum, card) => sum + card.qty, 0); const groups: Record<string, DeckCard[]> = { Creatures: [], Other: [], Lands: [] };
  deck.cards.forEach((card) => { const type = catalogMap.get(card.name.toLowerCase())?.type.toLowerCase() || ""; groups[type.includes("land") || card.isBasic ? "Lands" : type.includes("creature") ? "Creatures" : "Other"].push(card); });
  // Pool groups (WUBRG, colorless, multicolor). Off-color cards are hidden unless
  // "show off-color" is on, in which case they appear marked with + disabled. (Req 5, 6)
  const pool = buildPoolGroups(owned, { catalogByName: catalogMap, isBasic: isBasicName, isLegal: (name) => isLegalCard(name, false), search, showOffColor });
  const basics = BASICS.filter((name) => name.toLowerCase().includes(search.trim().toLowerCase()));
  const groupNames = [...pool.groups.map((g) => g.group), BASIC_LANDS_GROUP];
  const allCollapsed = groupNames.every((g) => collapsed.has(g));
  // Toggle a commander in/out of the selection, capped at 2 (Req 4.6).
  const setCommander = (name: string) => void saveDeck({ commander: toggleCommander(deck.deck.commander, name) });
  const isCommander = (name: string) => isCommanderName(deck.deck.commander, name);
  const starState = (name: string): StarState => {
    if (isCommander(name)) return "active";
    if (!eligibleCommanders.has(name.toLowerCase())) return "none";
    return commanderNames.length >= MAX_COMMANDERS ? "full" : "available";
  };
  const deckTile = (card: DeckCard) => <GalleryCard key={card.name} name={card.name} catalog={catalogMap.get(card.name.toLowerCase())} qty={card.qty} owned={card.isBasic ? undefined : ownedMap.get(card.name.toLowerCase())?.qty || 0} cap={card.isBasic ? 99 : ownedMap.get(card.name.toLowerCase())?.qty || 0} star={starState(card.name)} outOfIdentity={isCardOutOfIdentity(card.name, card.isBasic)} onQty={(qty) => void saveCard(card.name, qty)} onCommander={() => setCommander(card.name)} />;
  // Block the + stepper for out-of-identity non-basics (Req 7.4); decrease stays enabled (Req 7.3).
  const rowActions = (name: string, qty: number, cap: number, isBasic = false) => { const off = isCardOutOfIdentity(name, isBasic); return <div className="card-line-actions"><div className="mini-stepper"><button type="button" onClick={() => void saveCard(name, Math.max(0, qty - 1))} disabled={qty === 0} aria-label={`Decrease ${name}`}>−</button><b>{qty}</b><button type="button" onClick={() => void saveCard(name, qty + 1)} disabled={qty >= cap || off} aria-label={`Increase ${name}`}>+</button></div><CommanderStar name={name} state={starState(name)} onToggle={() => setCommander(name)} /></div>; };
  const offColorBadge = (name: string) => <span className="off-color-badge" title="Outside commander color identity" aria-label={`${name} is outside the commander color identity`}> ⚠</span>;

  // Sticky pool header: title, search, off-color toggle and collapse-all.
  const poolTitle = (title: string) => <div className="panel-title pool-title pool-toolbar">
    <h2>{title}</h2>
    <input className="search" type="search" placeholder="Search owned cards" aria-label="Search owned cards" value={search} onChange={(e) => setSearch(e.target.value)} />
    <div className="pool-controls">
      {commanderIdentity !== undefined && <button type="button" className={`off-color-toggle ${showOffColor ? "active" : ""}`} aria-pressed={showOffColor} onClick={() => setShowOffColor(!showOffColor)}>{showOffColor ? "Hide off-color cards" : `Show off-color cards (${pool.hiddenCount})`}</button>}
      <button type="button" className="collapse-all" onClick={() => storeCollapsed(allCollapsed ? new Set() : new Set(groupNames))}>{allCollapsed ? "Expand all" : "Collapse all"}</button>
    </div>
  </div>;
  const emptyPool = pool.groups.length === 0 && <p className="muted pool-empty">{search.trim() ? "No owned cards match your search." : pool.hiddenCount ? "Every other owned card is outside the commander's colors." : "No owned cards yet."}</p>;

  return <main className="deck-editor" ref={editorRef}><header className="workspace-header"><div><Link className="back-link" href={`/p/${profileId}/decks`}>← Back to decks</Link><form className="inline-title" onSubmit={rename}><input name="name" aria-label="Deck name" defaultValue={deck.deck.name} key={deck.deck.name} /><button>Rename</button></form></div><div className="header-stats"><strong>{total} cards · commander excluded</strong><span className={`save-state ${status.toLowerCase()}`}>{status}</span><div className="view-mode-switch" role="group" aria-label="Deck editor view mode"><button type="button" className={viewMode === "images" ? "active" : ""} aria-pressed={viewMode === "images"} onClick={() => changeViewMode("images")}>Images</button><button type="button" className={viewMode === "list" ? "active" : ""} aria-pressed={viewMode === "list"} onClick={() => changeViewMode("list")}>List</button></div></div></header>
    {error && <p className="error-banner deck-error" role="alert">{error}</p>}{viewMode === "images" ? <div className="editor-columns">
      <section className="deck-contents"><div className="panel-title"><h2>Deck</h2><span>{total} cards · commander excluded</span></div>
        {commanderNames.length > 0 && <section className="deck-group"><h3><span>★ {commanderNames.length > 1 ? "Commanders" : "Commander"}</span><small>{commanderNames.length}</small></h3><div className="deck-grid">{commanderNames.map((cmd) => <GalleryCard key={cmd} name={cmd} catalog={catalogMap.get(cmd.toLowerCase())} qty={deckMap.get(cmd.toLowerCase())?.qty || 0} owned={ownedMap.get(cmd.toLowerCase())?.qty} cap={ownedMap.get(cmd.toLowerCase())?.qty || 0} star="active" onQty={(qty) => void saveCard(cmd, qty)} onCommander={() => setCommander(cmd)} />)}</div></section>}
        {Object.entries(groups).map(([group, items]) => items.length ? <section className="deck-group" key={group}><h3><span>{group}</span><small>{items.reduce((sum, card) => sum + card.qty, 0)}</small></h3><div className="deck-grid">{items.sort((a, b) => a.name.localeCompare(b.name)).map(deckTile)}</div></section> : null)}
      </section>
      <aside className="add-panel">{poolTitle("Your collection")}
        {emptyPool}
        {pool.groups.map(({ group, entries }) => <PoolGroupSection key={group} title={group} count={`${entries.length} owned`} collapsed={collapsed.has(group)} onToggle={() => toggleGroup(group)}><div className="pool-grid">{entries.map(({ card, offColor }) => { const qty = deckMap.get(card.name.toLowerCase())?.qty || 0; return <GalleryCard key={card.name} name={card.name} catalog={catalogMap.get(card.name.toLowerCase())} qty={qty} owned={card.qty} cap={card.qty} star={starState(card.name)} outOfIdentity={offColor} imageAdds onQty={(next) => void saveCard(card.name, next)} onCommander={() => setCommander(card.name)} />; })}</div></PoolGroupSection>)}
        {basics.length > 0 && <PoolGroupSection title={BASIC_LANDS_GROUP} count="Unlimited · max 99" className="basic-block" collapsed={collapsed.has(BASIC_LANDS_GROUP)} onToggle={() => toggleGroup(BASIC_LANDS_GROUP)}><div className="pool-grid">{basics.map((name) => { const qty = deckMap.get(name.toLowerCase())?.qty || 0; return <GalleryCard key={name} name={name} catalog={catalogMap.get(name.toLowerCase())} qty={qty} cap={99} star={starState(name)} imageAdds onQty={(next) => void saveCard(name, next)} onCommander={() => setCommander(name)} />; })}</div></PoolGroupSection>}
      </aside>
    </div> : <div className="editor-columns list-view">
      <section className="deck-contents"><div className="panel-title"><h2>Deck contents</h2><span>{total} cards · commander excluded</span></div>
        {commanderNames.length > 0 && <section className="deck-group"><h3>{commanderNames.length > 1 ? "Commanders" : "Commander"} <small>{commanderNames.length}</small></h3>{commanderNames.map((cmd) => <div className="card-line" key={cmd}><span>{cmd}</span>{rowActions(cmd, deckMap.get(cmd.toLowerCase())?.qty || 0, ownedMap.get(cmd.toLowerCase())?.qty || 0)}</div>)}</section>}
        {Object.entries(groups).map(([group, items]) => items.length ? <section className="deck-group" key={group}><h3>{group} <small>{items.reduce((sum, card) => sum + card.qty, 0)}</small></h3>{items.sort((a, b) => a.name.localeCompare(b.name)).map((card) => <div className={`card-line ${isCardOutOfIdentity(card.name, card.isBasic) ? "out-of-identity" : ""}`} key={card.name}><span>{card.name}{isCardOutOfIdentity(card.name, card.isBasic) && offColorBadge(card.name)}</span>{rowActions(card.name, card.qty, card.isBasic ? 99 : ownedMap.get(card.name.toLowerCase())?.qty || 0, card.isBasic)}</div>)}</section> : null)}
      </section>
      <aside className="add-panel">{poolTitle("Add cards")}
        {emptyPool}
        {pool.groups.map(({ group, entries }) => <PoolGroupSection key={group} title={group} count={`${entries.length} owned`} collapsed={collapsed.has(group)} onToggle={() => toggleGroup(group)}><div className="add-list">{entries.map(({ card, offColor }) => { const qty = deckMap.get(card.name.toLowerCase())?.qty || 0; return <div className={`add-row ${offColor ? "out-of-identity" : ""}`} key={card.name}><span><b>{card.name}{offColor && offColorBadge(card.name)}</b><small>{qty} in deck · {card.qty} owned{offColor ? " · off-color" : ""}</small></span>{rowActions(card.name, qty, card.qty)}</div>; })}</div></PoolGroupSection>)}
        {basics.length > 0 && <PoolGroupSection title={BASIC_LANDS_GROUP} count="Unlimited · max 99" className="basic-block" collapsed={collapsed.has(BASIC_LANDS_GROUP)} onToggle={() => toggleGroup(BASIC_LANDS_GROUP)}><div className="add-list">{basics.map((name) => { const qty = deckMap.get(name.toLowerCase())?.qty || 0; return <div className="add-row" key={name}><span><b>{name}</b><small>{qty} in deck · unlimited owned</small></span>{rowActions(name, qty, 99, true)}</div>; })}</div></PoolGroupSection>}
      </aside>
    </div>}</main>;
}
