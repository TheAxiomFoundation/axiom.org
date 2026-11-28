import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useTreeNodes } from "./use-tree-nodes";
import { treeNodesCacheKey } from "@/lib/axiom/tree-cache";
import type { TreeNode } from "@/lib/tree-data";

const mockLoadTreeNodes = vi.fn();

vi.mock("@/lib/axiom/tree-node-loader", () => ({
  loadTreeNodes: (...args: unknown[]) => mockLoadTreeNodes(...args),
}));

function makeNode(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    segment: "statute",
    label: "Statutes",
    hasChildren: true,
    childCount: 100,
    nodeType: "doc_type",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTreeNodes", () => {
  it("uses matching server-provided initial nodes without fetching", () => {
    const nodes = [makeNode()];

    const { result } = renderHook(() =>
      useTreeNodes("us", [], true, false, {
        cacheKey: treeNodesCacheKey("us", [], false),
        nodes,
        hasMore: false,
        currentRule: null,
        leafRule: null,
      })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.nodes).toEqual(nodes);
    expect(mockLoadTreeNodes).not.toHaveBeenCalled();
  });

  it("loads tree nodes through the shared tree loader", async () => {
    const nodes = [makeNode()];
    mockLoadTreeNodes.mockResolvedValue({
      nodes,
      hasMore: false,
      currentRule: null,
      leafRule: null,
    });

    const { result } = renderHook(() => useTreeNodes("us", [], true));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockLoadTreeNodes).toHaveBeenCalledWith({
      dbJurisdictionId: "us",
      ruleSegments: [],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 0,
      encodedPaths: undefined,
    });
    expect(result.current.nodes).toEqual(nodes);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("passes encodedOnly through and keeps a separate cache key", async () => {
    mockLoadTreeNodes.mockResolvedValue({
      nodes: [makeNode()],
      hasMore: false,
      currentRule: null,
      leafRule: null,
    });

    const { result, rerender } = renderHook(
      ({ encoded }: { encoded: boolean }) =>
        useTreeNodes("us", ["statute"], true, encoded),
      { initialProps: { encoded: false } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockLoadTreeNodes).toHaveBeenCalledTimes(1);

    rerender({ encoded: true });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockLoadTreeNodes).toHaveBeenCalledTimes(2);
    expect(mockLoadTreeNodes).toHaveBeenLastCalledWith({
      dbJurisdictionId: "us",
      ruleSegments: ["statute"],
      hasCitationPaths: true,
      encodedOnly: true,
      page: 0,
      encodedPaths: undefined,
    });
  });

  it("caches results for return navigation", async () => {
    const rootNodes = [makeNode({ segment: "statute", label: "Statutes" })];
    const titleNodes = [makeNode({ segment: "26", label: "Title 26" })];
    mockLoadTreeNodes
      .mockResolvedValueOnce({
        nodes: rootNodes,
        hasMore: false,
        currentRule: null,
        leafRule: null,
      })
      .mockResolvedValueOnce({
        nodes: titleNodes,
        hasMore: false,
        currentRule: null,
        leafRule: null,
      });

    const { result, rerender } = renderHook(
      ({ segs }: { segs: string[] }) => useTreeNodes("us", segs, true),
      { initialProps: { segs: [] as string[] } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes).toEqual(rootNodes);

    rerender({ segs: ["statute"] });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes).toEqual(titleNodes);

    rerender({ segs: [] });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockLoadTreeNodes).toHaveBeenCalledTimes(2);
    expect(result.current.nodes).toEqual(rootNodes);
  });

  it("retains stale nodes while a new uncached path loads", async () => {
    const rootNodes = [
      makeNode({ segment: "statute", label: "Statutes" }),
      makeNode({ segment: "regulation", label: "Regulations" }),
    ];
    mockLoadTreeNodes.mockResolvedValueOnce({
      nodes: rootNodes,
      hasMore: false,
      currentRule: null,
      leafRule: null,
    });

    let resolveTitles: (value: unknown) => void;
    mockLoadTreeNodes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTitles = resolve;
        })
    );

    const { result, rerender } = renderHook(
      ({ segs }: { segs: string[] }) => useTreeNodes("us", segs, true),
      { initialProps: { segs: [] as string[] } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes).toEqual(rootNodes);

    rerender({ segs: ["statute"] });
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
      expect(result.current.stale).toBe(true);
      expect(result.current.nodes).toEqual(rootNodes);
    });

    resolveTitles!({
      nodes: [makeNode({ segment: "26", label: "Title 26" })],
      hasMore: false,
      currentRule: null,
      leafRule: null,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.nodes).toEqual([
      expect.objectContaining({ segment: "26", label: "Title 26" }),
    ]);
  });

  it("sets leafRule and currentRule from the loader result", async () => {
    const leafRule = { id: "leaf", heading: "Leaf" };
    mockLoadTreeNodes.mockResolvedValue({
      nodes: [],
      hasMore: false,
      currentRule: null,
      leafRule,
    });

    const { result } = renderHook(() =>
      useTreeNodes("us", ["statute", "26", "1"], true)
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.leafRule).toEqual(leafRule);
    expect(result.current.nodes).toEqual([]);
  });

  it("surfaces loader errors", async () => {
    mockLoadTreeNodes.mockRejectedValue(new Error("Navigation index missing"));

    const { result } = renderHook(() => useTreeNodes("us", [], true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Navigation index missing");
  });

  it("appends loadMore results", async () => {
    const page0Nodes = [makeNode({ segment: "1", label: "One" })];
    const page1Nodes = [makeNode({ segment: "2", label: "Two" })];

    mockLoadTreeNodes
      .mockResolvedValueOnce({
        nodes: page0Nodes,
        hasMore: true,
        currentRule: null,
        leafRule: null,
      })
      .mockResolvedValueOnce({
        nodes: page1Nodes,
        hasMore: false,
        currentRule: null,
        leafRule: null,
      });

    const { result } = renderHook(() =>
      useTreeNodes("us", ["statute"], true)
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockLoadTreeNodes).toHaveBeenLastCalledWith({
      dbJurisdictionId: "us",
      ruleSegments: ["statute"],
      hasCitationPaths: true,
      encodedOnly: false,
      page: 1,
      encodedPaths: undefined,
    });
    expect(result.current.nodes).toEqual([...page0Nodes, ...page1Nodes]);
    expect(result.current.hasMore).toBe(false);
  });

  it("keeps the level's rules when a later page brings nothing", async () => {
    // The level shrank between its first page and Load more: the later
    // page answers past the end, with no nodes and no rules of its own.
    const page0Nodes = [makeNode({ segment: "1", label: "One" })];
    const currentRule = { id: "current", heading: "Title 26" };
    const leafRule = { id: "leaf", heading: "Leaf" };
    mockLoadTreeNodes
      .mockResolvedValueOnce({
        nodes: page0Nodes,
        hasMore: true,
        currentRule,
        leafRule,
      })
      .mockResolvedValueOnce({ nodes: [], hasMore: false });

    const { result } = renderHook(() =>
      useTreeNodes("us", ["statute", "26"], true)
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockLoadTreeNodes).toHaveBeenCalledTimes(2);
    expect(result.current.nodes).toEqual(page0Nodes);
    expect(result.current.currentRule).toEqual(currentRule);
    expect(result.current.leafRule).toEqual(leafRule);
    expect(result.current.hasMore).toBe(false);
  });
});
