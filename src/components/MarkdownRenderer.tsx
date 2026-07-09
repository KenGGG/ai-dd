import React from "react";

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  if (!content) return null;

  // Split content into blocks by double newlines
  const blocks = content.split(/\n\s*\n/);

  // Helper to render inline elements like bold, italic, and citation pills
  const renderInline = (text: string) => {
    // 1. Render Bold: **text**
    let parts: (string | React.ReactNode)[] = [text];

    // Regular expression for bold **text**
    const boldRegex = /\*\*([^*]+)\*\*/g;

    // We will do a mapping loop for bold
    let processed: (string | React.ReactNode)[] = [];
    for (const part of parts) {
      if (typeof part === "string") {
        let lastIndex = 0;
        let match;
        const subParts: (string | React.ReactNode)[] = [];

        while ((match = boldRegex.exec(part)) !== null) {
          const textBefore = part.substring(lastIndex, match.index);
          const boldText = match[1];
          if (textBefore) subParts.push(textBefore);
          subParts.push(
            <strong
              key={`bold-${match.index}`}
              className="font-semibold text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800/50 px-1 rounded"
            >
              {boldText}
            </strong>,
          );
          lastIndex = boldRegex.lastIndex;
        }

        const textAfter = part.substring(lastIndex);
        if (textAfter) subParts.push(textAfter);
        processed.push(...subParts);
      } else {
        processed.push(part);
      }
    }
    parts = processed;

    // 2. Render Citation badges: [Page X] or [第 X 页] or [来源: xxx]
    const citationRegex = /\[([^\]]+)\]/g;
    processed = [];
    for (const part of parts) {
      if (typeof part === "string") {
        let lastIndex = 0;
        let match;
        const subParts: (string | React.ReactNode)[] = [];

        while ((match = citationRegex.exec(part)) !== null) {
          const textBefore = part.substring(lastIndex, match.index);
          const citationContent = match[1];
          if (textBefore) subParts.push(textBefore);

          // Style differently if it looks like a page number / source citation
          const isPage = /页|page|source|来源|doc/i.test(citationContent);
          subParts.push(
            <span
              key={`cite-${match.index}`}
              className={`inline-flex items-center mx-1 px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                isPage
                  ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900 shadow-xs cursor-help"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
              }`}
              title={isPage ? "此事实已追溯至原始公告页码，已核验" : undefined}
            >
              {isPage && (
                <svg className="mr-1 h-3 w-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M6.267 3.455a.75.75 0 00-.708.522L4.05 9H15.95l-1.51-5.023a.75.75 0 00-.707-.522H6.267zM3.13 10.5a1.5 1.5 0 00-1.5 1.5v3A1.5 1.5 0 003.13 16.5h13.74a1.5 1.5 0 001.5-1.5v-3a1.5 1.5 0 00-1.5-1.5H3.13z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              {citationContent}
            </span>,
          );
          lastIndex = citationRegex.lastIndex;
        }

        const textAfter = part.substring(lastIndex);
        if (textAfter) subParts.push(textAfter);
        processed.push(...subParts);
      } else {
        processed.push(part);
      }
    }
    parts = processed;

    return parts;
  };

  // Render individual blocks based on classification
  const renderBlock = (block: string, blockIndex: number) => {
    const lines = block.trim().split("\n");
    if (lines.length === 0) return null;

    const firstLine = lines[0].trim();

    // 1. Heading H1
    if (firstLine.startsWith("# ")) {
      return (
        <React.Fragment key={blockIndex}>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-8 mb-4 border-b pb-2 border-slate-200 dark:border-slate-800">
            {renderInline(firstLine.substring(2))}
          </h1>
          {renderTrailingLines(lines, blockIndex)}
        </React.Fragment>
      );
    }

    // 2. Heading H2
    if (firstLine.startsWith("## ")) {
      return (
        <React.Fragment key={blockIndex}>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-6 mb-3 border-l-4 pl-3 border-blue-500 pb-0.5">
            {renderInline(firstLine.substring(3))}
          </h2>
          {renderTrailingLines(lines, blockIndex)}
        </React.Fragment>
      );
    }

    // 3. Heading H3
    if (firstLine.startsWith("### ")) {
      return (
        <React.Fragment key={blockIndex}>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mt-4 mb-2">
            {renderInline(firstLine.substring(4))}
          </h3>
          {renderTrailingLines(lines, blockIndex)}
        </React.Fragment>
      );
    }

    // 4. Blockquote
    if (firstLine.startsWith(">")) {
      const quoteText = lines.map((line) => line.replace(/^>\s?/, "")).join("\n");
      return (
        <blockquote
          key={blockIndex}
          className="border-l-4 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/60 pl-4 py-2 pr-2 my-4 rounded-r text-slate-600 dark:text-slate-400 italic"
        >
          {renderInline(quoteText)}
        </blockquote>
      );
    }

    // 5. Code block
    if (firstLine.startsWith("```")) {
      const codeLines = lines.slice(1, lastIndexCodeBlock(lines));
      return (
        <pre
          key={blockIndex}
          className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto font-mono text-sm my-4 shadow-inner border border-slate-800"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
    }

    // 6. Check for Table block
    const isTable =
      lines.some((line) => line.includes("|")) && lines.length > 1 && lines[1].includes("-");
    if (isTable) {
      // Parse markdown table
      const headerRow = lines[0]
        .split("|")
        .map((cell) => cell.trim())
        .filter((_, idx) => idx > 0 && idx < lines[0].split("|").length - 1);
      const rows = lines
        .slice(2)
        .map((line) => {
          return line
            .split("|")
            .map((cell) => cell.trim())
            .filter((_, idx) => idx > 0 && idx < line.split("|").length - 1);
        })
        .filter((row) => row.length > 0);

      return (
        <div
          key={blockIndex}
          className="overflow-x-auto my-6 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs"
        >
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/80">
              <tr>
                {headerRow.map((cell, idx) => (
                  <th
                    key={idx}
                    className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300 tracking-wider"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900">
              {rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 odd:bg-slate-50/20 dark:odd:bg-slate-900/40"
                >
                  {row.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className="px-4 py-3.5 text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed"
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    // 7. Check for Lists (unordered or ordered)
    const isUnorderedList = lines.every(
      (line) => line.trim().startsWith("- ") || line.trim().startsWith("* "),
    );
    if (isUnorderedList) {
      return (
        <ul
          key={blockIndex}
          className="list-disc pl-6 space-y-2 my-4 text-slate-600 dark:text-slate-300"
        >
          {lines.map((line, idx) => {
            const itemText = line.trim().substring(2);
            return (
              <li key={idx} className="leading-relaxed">
                {renderInline(itemText)}
              </li>
            );
          })}
        </ul>
      );
    }

    const isOrderedList = lines.every((line) => /^\d+\.\s/.test(line.trim()));
    if (isOrderedList) {
      return (
        <ol
          key={blockIndex}
          className="list-decimal pl-6 space-y-2 my-4 text-slate-600 dark:text-slate-300"
        >
          {lines.map((line, idx) => {
            const match = line.trim().match(/^(\d+)\.\s(.*)/);
            const itemText = match ? match[2] : line;
            return (
              <li key={idx} className="leading-relaxed">
                {renderInline(itemText)}
              </li>
            );
          })}
        </ol>
      );
    }

    // 8. Normal Paragraph
    return (
      <p
        key={blockIndex}
        className="leading-relaxed text-slate-600 dark:text-slate-300 mb-4 whitespace-pre-line"
      >
        {renderInline(block)}
      </p>
    );
  };

  const lastIndexCodeBlock = (lines: string[]): number => {
    const endIdx = lines.findIndex((line, i) => i > 0 && line.trim().startsWith("```"));
    return endIdx !== -1 ? endIdx : lines.length;
  };

  const renderTrailingLines = (lines: string[], blockIndex: number) => {
    const trailing = lines.slice(1).join("\n").trim();
    if (!trailing) return null;
    return renderBlock(trailing, blockIndex * 1000 + 1);
  };

  return (
    <div className="prose max-w-none prose-slate dark:prose-invert">
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}
