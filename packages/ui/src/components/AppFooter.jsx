export default function AppFooter({
  product = "ZenControl",
  version = "6.4.0",
}) {
  return (
    <footer className="page-footer">
      <span className="footer-product">
        {product} · v{version}
      </span>
      <span>
        Desenvolvido por <strong>Victor Rodrigues</strong>
      </span>
    </footer>
  );
}
