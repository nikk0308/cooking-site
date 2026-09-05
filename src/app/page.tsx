import Image from "next/image";
import styles from "./page.module.css";
export const dynamic = "force-dynamic";
export default function Home() {
  return (
    <main className={styles.main}>
      <Image
        className={styles.mark}
        src="/favicon.ico"
        width={96}
        height={96}
        alt=""
        priority
      />
      <h1>Recipes</h1>
      <p>Основа проекта готова.</p>
      <p className={styles.note}>Pet project / work in progress</p>
    </main>
  );
}
