let current = $state('');
let revision = $state(0);

export function currentLanguage(): string {
  return current;
}

export function setCurrentLanguage(code: string): void {
  current = code;
}

export function trackTranslations(): void {
  void revision;
}

export function translationsChanged(): void {
  revision += 1;
}
