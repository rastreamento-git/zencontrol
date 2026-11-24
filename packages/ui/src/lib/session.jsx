import { createContext, useContext } from "react";
export const SessionContext = createContext(null);
export const useSession = () => useContext(SessionContext);
export const SessionNameContext = createContext(() => {});
export const useSessionName = () => useContext(SessionNameContext);
