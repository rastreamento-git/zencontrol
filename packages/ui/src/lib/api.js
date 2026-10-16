import axios from "axios";
import { apiBaseUrl } from "./api-url";
const TOKEN_KEY =
  import.meta.env.VITE_APP_AUDIENCE === "technician"
    ? "technician.session"
    : "zencontrol.session";
let mutationPending = false;

export const api = axios.create({
  baseURL: apiBaseUrl(import.meta.env.VITE_API_URL),
  timeout: 30000,
});

export function saveToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function errorMessage(error) {
  if (error.code === "INVENT_BUSY") return "Aguarde a operação em andamento.";
  if (error.response?.data?.error) return error.response.data.error;
  if (error.code === "ECONNABORTED")
    return "A API demorou a responder. Atualize os dados para conferir se a operação foi concluída antes de repetir.";
  if (!error.response)
    return "Não foi possível acessar a API. Confira a conexão e tente atualizar os dados.";
  return "Não foi possível concluir a operação.";
}

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;

  if (!["get", "head", "options"].includes(config.method)) {
    if (mutationPending) {
      const error = new Error("Aguarde a operação em andamento.");
      error.code = "INVENT_BUSY";
      return Promise.reject(error);
    }
    mutationPending = true;
    config.inventoryMutation = true;
    window.dispatchEvent(new CustomEvent("invent:busy", { detail: true }));
  }
  return config;
});

function finish(config) {
  if (!config?.inventoryMutation) return;
  mutationPending = false;
  window.dispatchEvent(new CustomEvent("invent:busy", { detail: false }));
}

api.interceptors.response.use(
  (response) => {
    finish(response.config);
    return response;
  },
  (error) => {
    finish(error.config);
    if (
      error.response?.status === 401 &&
      !error.config?.url?.includes("auth/")
    ) {
      saveToken(null);
      window.dispatchEvent(new Event("invent:unauthorized"));
    }
    return Promise.reject(error);
  },
);
