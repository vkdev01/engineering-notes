import Link from "next/link";
import ThemePicker from "./ThemePicker";
import ChatButton from "./ChatButton";

export default function TopBar({
  title,
  version,
  exerciseCount,
}: {
  title: string;
  version?: string;
  exerciseCount: number;
}) {
  return (
    <header className="topbar">
      <div className="in">
        <Link href="/" className="brand">
          {title}
        </Link>
        {version ? <span>{version}</span> : null}
        <span className="spacer" />
        <ThemePicker />
        <ChatButton />
        <Link href="/#contents" className="tag">
          contents
        </Link>
        <span className="tag accent">{exerciseCount} exercises</span>
      </div>
    </header>
  );
}
