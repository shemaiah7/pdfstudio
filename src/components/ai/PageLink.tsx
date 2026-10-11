export function scrollToPage(page: number) {
  const el = document.querySelectorAll<HTMLElement>(".pageview .page")[page - 1];
  el?.scrollIntoView({ block: "start", behavior: "smooth" });
}

export default function PageLink({ page }: { page: number }) {
  return <button className="pagelink" onClick={() => scrollToPage(page)} title={`Go to page ${page}`}>p. {page}</button>;
}
