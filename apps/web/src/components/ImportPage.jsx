import { useState } from "react";
import { Database, FileSpreadsheet } from "lucide-react";
import { Intro } from "./common";
import SpreadsheetImport from "./SpreadsheetImport";
import SgaIntake from "./SgaIntake";
export default function ImportPage(props) {
  const [tab, setTab] = useState("sga");
  return (
    <>
      <Intro title="Importação de dados" subtitle="Escolha a origem e envie os cadastros para o Controle de OS."/>
      <nav className="sga-import-tabs" aria-label="Origem da importação">
        <button
          className={tab === "sga" ? "primary-button" : "secondary-button"}
          aria-pressed={tab === "sga"}
          onClick={() => setTab("sga")}
        >
          <Database size={16} aria-hidden="true"/> SGA · Instalações pendentes
        </button>
        <button
          className={tab === "spreadsheet" ? "primary-button" : "secondary-button"}
          aria-pressed={tab === "spreadsheet"}
          onClick={() => setTab("spreadsheet")}
        >
          <FileSpreadsheet size={16} aria-hidden="true"/> Planilha de controle
        </button>
      </nav>
      {tab === "sga" ? (
        <SgaIntake {...props} settings={true} />
      ) : (
        <SpreadsheetImport />
      )}
    </>
  );
}
