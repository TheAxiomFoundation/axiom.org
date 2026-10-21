"use client";

import { useCallback, useEffect, useState } from "react";
import type { FlowModel } from "@/lib/axiom/pipeline-flow";
import { flowHref, type FlowParams } from "./flow-params";
import { PipelineCanvas } from "./pipeline-canvas";
import { StationPanel } from "./station-panel";
import styles from "./flow.module.css";

/**
 * The diagram and its station panel. The page already holds every station's
 * numbers, so a click opens the panel in place and only rewrites the address
 * (to share or reload), with no trip to the server.
 */
export function PipelineFloor({ model, params }: { model: FlowModel; params: FlowParams }) {
  const [selected, setSelected] = useState<string | null>(params.station);
  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      window.history.replaceState(window.history.state, "", flowHref(params, { station: id }));
    },
    [params]
  );
  // A new page (another window or scope) brings its own station.
  useEffect(() => setSelected(params.station), [params.station]);
  const station = selected ? (model.stations.find((s) => s.id === selected) ?? null) : null;
  const hrefFor = Object.fromEntries(model.stations.map((s) => [s.id, flowHref(params, { station: s.id })]));
  return (
    <div className={styles.floor} data-panel={station ? "true" : "false"}>
      <PipelineCanvas model={model} selected={station?.id ?? null} hrefFor={hrefFor} onSelect={(id) => select(id === selected ? null : id)} />
      {station ? <StationPanel station={station} model={model} params={{ ...params, station: station.id }} onClose={() => select(null)} /> : null}
    </div>
  );
}
