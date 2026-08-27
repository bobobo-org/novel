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
        <button
          className={styles.iconButton}
          type="button"
          data-testid="conversation-mobile-sidebar-toggle"
          aria-label="打開專案與對話側欄"
          aria-expanded={sidebarOpen}
          aria-controls="conversation-session-sidebar"
          onClick={onOpenSidebar}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <strong>{title}</strong>
        <button className={styles.iconButton} type="button" aria-label="打開作品結果" onClick={onOpenArtifacts}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" /></svg></button>
      </header>
      {(sidebarOpen || artifactOpen) ? (
        <button
          className={styles.backdrop}
          type="button"
          data-sidebar-open={sidebarOpen}
          data-artifact-open={artifactOpen}
          aria-label="關閉抽屜"
          onClick={onClose}
        />
      ) : null}
    </>
  );
}
