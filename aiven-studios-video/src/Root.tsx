import { Composition, Folder } from "remotion";
import { AivenVideo } from "./AivenVideo";
import { HookScene } from "./scenes/HookScene";
import { LogoScene } from "./scenes/LogoScene";
import { AiScene } from "./scenes/AiScene";
import { AutomationScene } from "./scenes/AutomationScene";
import { WebsiteScene } from "./scenes/WebsiteScene";
import { ValuesScene } from "./scenes/ValuesScene";
import { OutroScene } from "./scenes/OutroScene";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AivenStudios"
        component={AivenVideo}
        durationInFrames={2040}
        fps={60}
        width={1920}
        height={1080}
      />
      <Folder name="AivenStudios-Scenes">
        <Composition id="Hook" component={HookScene} durationInFrames={250} fps={60} width={1920} height={1080} />
        <Composition id="Logo" component={LogoScene} durationInFrames={250} fps={60} width={1920} height={1080} />
        <Composition id="AI-integratie" component={AiScene} durationInFrames={370} fps={60} width={1920} height={1080} />
        <Composition id="Automatisering" component={AutomationScene} durationInFrames={370} fps={60} width={1920} height={1080} />
        <Composition id="Websites" component={WebsiteScene} durationInFrames={370} fps={60} width={1920} height={1080} />
        <Composition id="Waarom" component={ValuesScene} durationInFrames={250} fps={60} width={1920} height={1080} />
        <Composition id="Outro" component={OutroScene} durationInFrames={240} fps={60} width={1920} height={1080} />
      </Folder>
    </>
  );
};
