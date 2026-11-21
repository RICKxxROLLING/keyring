// server/lib/xml.ts — just enough XML to read a MISMO appraisal file.
//
// Why not a library: the input is one well-defined dialect (MISMO 3.x as the
// GSEs deliver it: elements, attributes, text, comments), and the dangerous
// parts of XML — DTDs, external entities, entity expansion — are exactly the
// parts this needs none of. A reader that refuses a DOCTYPE outright cannot be
// talked into fetching a URL or expanding a billion laughs, whatever the file
// says. Only the five predefined entities and numeric character references
// are decoded.
//
// Namespaces are dropped to local names ("gse:Foo" -> "Foo"): the GSE files
// put their extension elements in a second namespace, and nothing here needs
// to tell the two apart.

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[ref] ?? m;
  });
}

function localName(qname: string): string {
  const i = qname.indexOf(":");
  return i === -1 ? qname : qname.slice(i + 1);
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Parse a document. Throws XmlError on anything malformed or on a DOCTYPE. */
export function parseXml(input: string): XmlNode {
  const src = input.replace(/^\uFEFF/, "");
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      stack[stack.length - 1]!.text += decode(src.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1]!.text += decode(src.slice(i, lt));

    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end === -1) throw new XmlError("Unterminated comment.");
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      if (end === -1) throw new XmlError("Unterminated CDATA section.");
      stack[stack.length - 1]!.text += src.slice(lt + 9, end);
      i = end + 3;
    } else if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      if (end === -1) throw new XmlError("Unterminated processing instruction.");
      i = end + 2;
    } else if (src.startsWith("<!", lt)) {
      // DOCTYPE or any other declaration. Refused, not skipped: it is the only
      // way an entity definition could get into the document.
      throw new XmlError("Document type declarations are not accepted.");
    } else if (src[lt + 1] === "/") {
      const end = src.indexOf(">", lt);
      if (end === -1) throw new XmlError("Unterminated closing tag.");
      const name = localName(src.slice(lt + 2, end).trim());
      const open = stack.pop();
      if (!open || open === root || open.name !== name) {
        throw new XmlError(`Mismatched closing tag </${name}>.`);
      }
      i = end + 1;
    } else {
      // Find the end of the tag, skipping ">" inside quoted attribute values.
      let j = lt + 1;
      let quote: string | null = null;
      for (; j < src.length; j++) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (j >= src.length) throw new XmlError("Unterminated tag.");
      let body = src.slice(lt + 1, j);
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      const nameMatch = /^[^\s/>]+/.exec(body);
      if (!nameMatch) throw new XmlError("Tag without a name.");
      const node: XmlNode = { name: localName(nameMatch[0]), attrs: {}, children: [], text: "" };
      for (const m of body.slice(nameMatch[0].length).matchAll(ATTR)) {
        node.attrs[localName(m[1]!)] = decode(m[3] ?? m[4] ?? "");
      }
      stack[stack.length - 1]!.children.push(node);
      if (!selfClosing) stack.push(node);
      i = j + 1;
    }
    if (stack.length > 512) throw new XmlError("Document nested too deeply.");
  }

  if (stack.length !== 1) throw new XmlError(`Unclosed element <${stack[stack.length - 1]!.name}>.`);
  const elements = root.children;
  if (elements.length !== 1) throw new XmlError("Expected exactly one root element.");
  return elements[0]!;
}

/** Every descendant with this local name, document order. `skip` prunes subtrees. */
export function findAll(node: XmlNode, name: string, skip?: (n: XmlNode) => boolean): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode): void => {
    for (const c of n.children) {
      if (skip && skip(c)) continue;
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

export function findFirst(node: XmlNode, name: string, skip?: (n: XmlNode) => boolean): XmlNode | null {
  return findAll(node, name, skip)[0] ?? null;
}

/** Trimmed text of the first descendant with this name, or null if absent or empty. */
export function textOf(node: XmlNode | null, name: string, skip?: (n: XmlNode) => boolean): string | null {
  if (!node) return null;
  const hit = findFirst(node, name, skip);
  const t = hit?.text.trim();
  return t ? t : null;
}

/** Trimmed text of every descendant with this name. */
export function textsOf(node: XmlNode | null, name: string, skip?: (n: XmlNode) => boolean): string[] {
  if (!node) return [];
  return findAll(node, name, skip)
    .map((n) => n.text.trim())
    .filter((t) => t.length > 0);
}
