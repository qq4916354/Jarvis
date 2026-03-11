/**
 * Accessibility tree snapshot builder using CDP (Chrome DevTools Protocol).
 *
 * Extracts the page's accessibility tree and formats it with unique IDs (UIDs)
 * so the AI can reference specific elements for interaction.
 */

import type { Page, CDPSession } from 'playwright';

export interface SnapshotNode {
  uid: string;
  role: string;
  name: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  required?: boolean;
  children?: SnapshotNode[];
}

interface UidMapEntry {
  role: string;
  name: string;
}

// Roles to skip (decorative or structural noise)
const SKIP_ROLES = new Set([
  'none',
  'presentation',
  'generic',
  'InlineTextBox',
  'LineBreak',
  'ignored',
]);

export async function buildAccessibilitySnapshot(
  page: Page,
  snapshotId: string,
  verbose: boolean = false
): Promise<{ tree: SnapshotNode[]; uidMap: Map<string, UidMapEntry> }> {
  const uidMap = new Map<string, UidMapEntry>();
  let nodeIndex = 0;

  // Use CDP to get the full accessibility tree
  let cdp: CDPSession;
  try {
    cdp = await page.context().newCDPSession(page);
  } catch {
    // Fallback: return empty tree if CDP not available
    return { tree: [], uidMap };
  }

  let axNodes: any[];
  try {
    const result = await cdp.send('Accessibility.getFullAXTree');
    axNodes = result.nodes || [];
  } catch {
    await cdp.detach().catch(() => {});
    return { tree: [], uidMap };
  }

  await cdp.detach().catch(() => {});

  if (axNodes.length === 0) {
    return { tree: [], uidMap };
  }

  // Build parent-child map from flat CDP node list
  const nodeById = new Map<string, any>();
  for (const n of axNodes) {
    nodeById.set(n.nodeId, n);
  }

  function getProperty(node: any, propName: string): any {
    if (!node.properties) return undefined;
    const prop = node.properties.find((p: any) => p.name === propName);
    return prop?.value?.value;
  }

  function processNode(axNode: any): SnapshotNode | null {
    const role = axNode.role?.value || 'unknown';
    const name = axNode.name?.value || '';

    // Skip noise nodes
    if (!verbose && SKIP_ROLES.has(role)) {
      // Process children and bubble them up
      if (axNode.childIds?.length) {
        const children = axNode.childIds
          .map((id: string) => nodeById.get(id))
          .filter(Boolean)
          .map((c: any) => processNode(c))
          .filter(Boolean) as SnapshotNode[];
        if (children.length === 1) return children[0];
        if (children.length > 1) {
          const uid = `${snapshotId}_${nodeIndex++}`;
          uidMap.set(uid, { role: 'group', name: '' });
          return { uid, role: 'group', name: '', children };
        }
      }
      return null;
    }

    // Skip ignored nodes
    if (axNode.ignored) return null;

    const uid = `${snapshotId}_${nodeIndex++}`;
    const node: SnapshotNode = { uid, role, name };

    // Extract properties
    const value = axNode.value?.value;
    if (value !== undefined && value !== '') {
      node.value = String(value);
    }

    const checked = getProperty(axNode, 'checked');
    if (checked !== undefined) node.checked = checked === 'true' || checked === true;

    const disabled = getProperty(axNode, 'disabled');
    if (disabled === true || disabled === 'true') node.disabled = true;

    const expanded = getProperty(axNode, 'expanded');
    if (expanded !== undefined) node.expanded = expanded === 'true' || expanded === true;

    const required = getProperty(axNode, 'required');
    if (required === true || required === 'true') node.required = true;

    uidMap.set(uid, { role, name });

    // Process children
    if (axNode.childIds?.length) {
      const children = axNode.childIds
        .map((id: string) => nodeById.get(id))
        .filter(Boolean)
        .map((c: any) => processNode(c))
        .filter(Boolean) as SnapshotNode[];
      if (children.length > 0) {
        node.children = children;
      }
    }

    return node;
  }

  // Root is typically the first node
  const rootNode = axNodes[0];
  let tree: SnapshotNode[];

  if (rootNode?.childIds?.length) {
    tree = rootNode.childIds
      .map((id: string) => nodeById.get(id))
      .filter(Boolean)
      .map((c: any) => processNode(c))
      .filter(Boolean) as SnapshotNode[];
  } else {
    const root = processNode(rootNode);
    tree = root ? [root] : [];
  }

  return { tree, uidMap };
}
