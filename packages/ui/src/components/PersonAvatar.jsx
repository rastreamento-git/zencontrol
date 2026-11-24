import { useEffect, useRef, useState } from "react";
import { api, sessionToken } from "../lib/api";

export const roleLabels = {
  admin: "Administrador",
  operador: "Operador",
  tecnico: "Técnico",
};

const avatars = new Map();
let cachedSession;
function fetchAvatar(path) {
  const token = sessionToken();
  if (cachedSession !== token) {
    avatars.clear();
    cachedSession = token;
  }
  if (!avatars.has(path)) {
    if (avatars.size >= 256) avatars.delete(avatars.keys().next().value);
    const request = api
      .get(path)
      .then(({ data }) => data.image)
      .catch((error) => {
        if (avatars.get(path) === request) avatars.delete(path);
        throw error;
      });
    avatars.set(path, request);
  }
  return avatars.get(path);
}

export default function PersonAvatar({ name, userId, version }) {
  const ref = useRef(null);
  const [photo, setPhoto] = useState(null);
  const path =
    userId && version ? "/chat/avatars/" + userId + "/" + version : "";
  useEffect(() => {
    if (!path) return;
    let active = true;
    function load() {
      fetchAvatar(path).then(
        (image) => active && setPhoto({ path, image }),
        () => {},
      );
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        observer.disconnect();
        load();
      }
    });
    observer.observe(ref.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [path]);
  const initials =
    (name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join("")
      .toLocaleUpperCase("pt-BR") || "?";
  return (
    <span ref={ref} className="zen-person-avatar" aria-hidden="true">
      {path && photo?.path === path ? (
        <img src={photo.image} alt="" />
      ) : (
        initials
      )}
    </span>
  );
}
