import { DocsNav } from "./DocsNav";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container docs-layout">
      <DocsNav />
      <div className="docs-main">{children}</div>
    </div>
  );
}
