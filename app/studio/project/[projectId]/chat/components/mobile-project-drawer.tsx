import styles from "../conversation.module.css";

export function MobileProjectDrawer({
  title,
  sidebarOpen,
  artifactOpen,
  onOpenSidebar,
  onOpenArtifacts,
  onClose,
}: {
  title: string;
  sidebarOpen: boolean;
  artifactOpen: boolean;
  onOpenSidebar: () => void;
  onOpenArtifacts: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <header className={styles.mobileBar} data-testid="conversation-mobile-project-controls">
        <button className={styles.iconButton} type="button" aria-label="打開專案欄" onClick={onOpenSidebar}>☰</button>
        <strong>{title}</strong>
        <button className={styles.iconButton} type="button" aria-label="打開作品結果" onClick={onOpenArtifacts}>◇</button>
      </header>
      {(sidebarOpen || artifactOpen) ? (
        <button className={styles.backdrop} type="button" aria-label="關閉抽屜" onClick={onClose} />
      ) : null}
    </>
  );
}
