export const passwordRequirements = "Use de 8 a 128 caracteres, com pelo menos uma letra maiúscula, uma minúscula, um número e um símbolo.";
export const passwordInputProps = {
  minLength: 8,
  maxLength: 128,
  pattern: "(?=.*\\p{Lu})(?=.*\\p{Ll})(?=.*[0-9])(?=.*[\\p{P}\\p{S}]).*",
  title: passwordRequirements,
};
