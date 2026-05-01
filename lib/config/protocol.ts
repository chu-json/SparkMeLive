// =============================================================================
// Protocol schema TypeScript types
//
// This schema supports the full AVP protocol structure with:
//   - Broad topics (e.g. "Peak Experience")
//   - Ordered subquestions (sub1 probes)
//   - Nested probe layers (sub2, sub3)
//
// The design anticipates utility-based question selection from SparkMe's
// exploration_planner. The `probe_group` field maps to sub1/sub2/sub3 layers
// in the protocol spreadsheet. `order` within each probe_group determines
// the required asking sequence.
//
// Future integration: when the SparkMe exploration_planner is wired in,
// it can traverse this tree to assign utility scores per node, enabling
// the same rollout-based prioritization used in the Python system.
// =============================================================================

export type ProbeGroup = "sub1" | "sub2" | "sub3";

/** A single probe question, potentially with nested follow-up probes */
export interface ProtocolProbe {
  /** Unique identifier, e.g. "peak_1_2" */
  id: string;
  /** The question text as it appears in the protocol */
  text: string;
  /** Position within this probe_group layer */
  order: number;
  /** Which layer of the sub-question hierarchy this belongs to */
  probe_group: ProbeGroup;
  /**
   * Child probes (deeper sub-layers).
   * sub1 nodes have sub2 children; sub2 nodes may have sub3 children.
   * The interviewer should exhaust sub1 before diving into sub2/sub3,
   * though the LLM may choose to interleave naturally.
   */
  children?: ProtocolProbe[];
}

/** A top-level interview domain with its ordered sub-question tree */
export interface ProtocolTopic {
  /** Human-readable topic name, e.g. "Peak Experience" */
  topic: string;
  /** Determines broad sequencing across the interview (1-indexed) */
  order: number;
  /**
   * The main probes for this topic (sub1 layer).
   * These must be asked in `order` sequence before their children.
   */
  subquestions: ProtocolProbe[];
}

/** Full protocol — array of topics defining the interview plan */
export type Protocol = ProtocolTopic[];

// ---------------------------------------------------------------------------
// Helper utilities for protocol traversal
// ---------------------------------------------------------------------------

/** Flatten a protocol into a single ordered array of all probes (BFS order) */
export function flattenProtocol(protocol: Protocol): ProtocolProbe[] {
  const result: ProtocolProbe[] = [];

  const visit = (probe: ProtocolProbe) => {
    result.push(probe);
    if (probe.children) {
      for (const child of probe.children) {
        visit(child);
      }
    }
  };

  for (const topic of protocol) {
    for (const sq of topic.subquestions) {
      visit(sq);
    }
  }

  return result;
}

/** Render the protocol as a concise outline string for LLM context injection */
export function protocolToOutline(protocol: Protocol): string {
  const lines: string[] = ["# Interview Protocol Overview\n"];

  for (const topic of protocol) {
    lines.push(`## ${topic.order}. ${topic.topic}`);
    for (const sq of topic.subquestions) {
      lines.push(`  [sub1] ${sq.text}`);
      if (sq.children) {
        for (const child of sq.children) {
          const indent = child.probe_group === "sub2" ? "    " : "      ";
          lines.push(`${indent}[${child.probe_group}] ${child.text}`);
          if (child.children) {
            for (const grandchild of child.children) {
              lines.push(`        [${grandchild.probe_group}] ${grandchild.text}`);
            }
          }
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
