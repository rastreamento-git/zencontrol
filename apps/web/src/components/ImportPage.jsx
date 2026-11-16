import { useState } from "react";
import SpreadsheetImport from "./SpreadsheetImport";
import SgaIntake from "./SgaIntake";
export default function ImportPage(props) {
  const [tab, setTab] = useState("sga");
  return (
    <>
      <nav className="sga-import-tabs" aria-label="Origem da importação">
        <button
          className="secondary-button"
          aria-pressed={tab === "sga"}
          onClick={() => setTab("sga")}
        >
          SGA · Instalações pendentes
        </button>
        <button
          className="secondary-button"
          aria-pressed={tab === "spreadsheet"}
          onClick={() => setTab("spreadsheet")}
        >
          Planilha de controle
        </button>
      </nav>
      {tab === "sga" ? (
        <SgaIntake settings {...props} />
      ) : (
        <SpreadsheetImport />
      )}
    </>
  );
}
