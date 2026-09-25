"use client";

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { decodeLocation, encodeLocation, parseGraphDocument, type GraphDocument, type GraphLocation } from "@axiom-foundation/orrery";
import { fromAxiomProgramGraph } from "@axiom-foundation/orrery/adapters/axiom";
import { GraphExplorer } from "@axiom-foundation/orrery/react";
import { displayNameForProgram, fetchAllPrograms, fetchComposedGraph, fetchProgramGraph, programKey } from "@/components/axiom/graph-viewer/api";
import { axiomAppUrl } from "@/components/axiom/graph-viewer/citations";
import type { ProgramSummary } from "@/components/axiom/graph-viewer/types";
import { initialOrreryLocation, nativeGraphHref, orreryRequestKey, readOrreryRequest } from "./navigation";
import "@axiom-foundation/orrery/style.css";
import "./orrery.css";

interface LoadedGraph { document: GraphDocument; ruleIds: Set<string>; truncated: boolean; source: string }

function locationFromAddress(document: GraphDocument): GraphLocation {
  return initialOrreryLocation(window.location.hash, readOrreryRequest(window.location.search), document);
}

class PreviewBoundary extends Component<{ children: ReactNode; fallbackHref: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="ao-message" role="alert"><p>Orrery could not render this graph.</p><a href={this.props.fallbackHref}>Open the Axiom viewer</a></div>;
    return this.props.children;
  }
}

/** Read-only host: data comes from the same native API as the current viewer. */
export function OrreryApp() {
  const [search, setSearch] = useState(() => window.location.search);
  const [location, setLocation] = useState<GraphLocation>(() => decodeLocation(window.location.hash));
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [programError, setProgramError] = useState("");
  const [loaded, setLoaded] = useState<LoadedGraph | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useMemo(() => readOrreryRequest(search), [search]);
  const requestKey = orreryRequestKey(request);
  const fallbackHref = nativeGraphHref(search);

  useEffect(() => {
    let active = true;
    fetchAllPrograms().then(value => { if (active) setPrograms(value); }).catch(() => {
      if (active) setProgramError("The program list is unavailable. Existing program links can still be opened.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const sync = () => {
      const nextSearch = window.location.search;
      const sameGraph = loaded?.document.id === `axiom:${orreryRequestKey(readOrreryRequest(nextSearch))}`;
      setSearch(nextSearch);
      setLocation(sameGraph ? locationFromAddress(loaded!.document) : decodeLocation(window.location.hash));
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("hashchange", sync); };
  }, [loaded]);

  useEffect(() => {
    if (!loaded || loaded.document.id !== `axiom:${requestKey}` || window.location.hash) return;
    // Canonicalize after Next's navigation commit. Doing this inside popstate
    // races the router's history writer, which can restore the unhashed URL.
    // A native focus belongs to this original history entry; Back must restore
    // its shared location even when the program/document have not changed.
    const next = locationFromAddress(loaded.document);
    const hash = encodeLocation(next);
    if (!hash) return;
    const url = new URL(window.location.href); url.hash = hash;
    window.history.replaceState(window.history.state, "", url);
    setLocation(next);
  }, [loaded, search, requestKey]);

  useEffect(() => {
    let active = true;
    setLoaded(null); setError("");
    if (!requestKey) { setLoading(false); return; }
    setLoading(true);
    const read = request.compose
      ? fetchComposedGraph(request.compose)
      : fetchProgramGraph(request.program!).then(graph => ({ graph, truncated: false }));
    read.then(result => {
      if (!active) return;
      const source = request.compose ? "Native composed graph" : `Native package · ${programKey(request.program!)}`;
      const document = parseGraphDocument(fromAxiomProgramGraph(result.graph, {
        id: `axiom:${requestKey}`,
        title: request.compose ? "Axiom · composed dependencies" : `Axiom · ${displayNameForProgram(request.program!)}`,
        provenance: { source: "axiom-native-api", projection: "read-only", truncated: result.truncated },
      }));
      setLoaded({ document, ruleIds: new Set(result.graph.rules.map(rule => rule.legalId)), source, truncated: result.truncated });
      setLocation(locationFromAddress(document));
    }).catch(() => {
      if (active) setError("The native Axiom graph could not be loaded. Try the current viewer or choose another program.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Hash navigation never re-fetches or replaces the native snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const navigate = (next: GraphLocation) => {
    const hash = encodeLocation(next);
    if (hash !== window.location.hash) {
      const url = new URL(window.location.href);
      url.hash = hash;
      const queryOnly = encodeLocation({ ...next, query: undefined }) === encodeLocation({ ...location, query: undefined });
      if (queryOnly) window.history.replaceState(null, "", url); else window.history.pushState(null, "", url);
    }
    setLocation(next);
  };

  const chooseProgram = (key: string) => {
    const url = new URL(window.location.href);
    if (key) url.searchParams.set("program", key); else url.searchParams.delete("program");
    url.searchParams.delete("compose"); url.searchParams.delete("focus"); url.hash = "";
    window.history.pushState(null, "", url);
    setSearch(url.search); setLocation({});
  };

  const selectedProgram = request.program ? programKey(request.program) : "";
  return <section className="ao-preview" aria-label="Orrery dependency preview">
    <header className="ao-bar">
      <div><strong>Orrery <span>by Axiom</span></strong><p>Dependency preview · read-only</p></div>
      <label>Program<select value={selectedProgram} onChange={event => chooseProgram(event.target.value)}>
        <option value="">{request.compose ? "Composed graph" : "Choose a program"}</option>
        {selectedProgram && !programs.some(program => programKey(program) === selectedProgram) && <option value={selectedProgram}>{selectedProgram}</option>}
        {programs.map(program => <option key={programKey(program)} value={programKey(program)}>{displayNameForProgram(program)}</option>)}
      </select></label>
      <a className="ao-native-link" href={fallbackHref}>Open Axiom viewer ↗</a>
    </header>
    <div className="ao-status">
      <span>{loaded?.source ?? "Native Axiom program dependencies"}. Run calculations and use the rule lens in the Axiom viewer.</span>
      {loaded?.truncated && <strong role="status">The native API truncated this graph.</strong>}
    </div>
    {programError && <p className="ao-notice" role="status">{programError}</p>}
    {(error || request.error) && <div className="ao-message" role="alert"><p>{error || request.error}</p><a href={fallbackHref}>Open the Axiom viewer</a></div>}
    {loading && <p className="ao-message" role="status">Loading native dependencies…</p>}
    {!requestKey && !request.error && <p className="ao-message">Choose a program to inspect its rules, inputs, relations, and source records.</p>}
    {loaded && <div className="ao-canvas"><PreviewBoundary key={requestKey} fallbackHref={fallbackHref}>
      <GraphExplorer document={loaded.document} location={location} onLocationChange={navigate} searchFiltersCanvas={false}
        renderToolbar={context => context.node && loaded.ruleIds.has(context.node.id) && <a href={nativeGraphHref(search, context.node.id)}>Open rule in Axiom ↗</a>}
        renderNodeDetails={node => {
          const fileId = node.data?.fileLegalId;
          const href = typeof fileId === "string" ? axiomAppUrl(fileId) : null;
          return href ? <p><a href={href}>Read the source law ↗</a></p> : null;
        }} />
    </PreviewBoundary></div>}
  </section>;
}
