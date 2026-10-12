import { Composition, Folder } from "remotion";
import { AivenVideo, TIMELINE, TOTAL_BEATS } from "./AivenVideo";
import { b, FPS } from "./brand";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AivenStudios"
        component={AivenVideo}
        durationInFrames={b(TOTAL_BEATS)}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Folder name="AivenStudios-Scenes">
        {TIMELINE.map(([Scene, name, start, beats], i) => (
          <Composition
            key={name}
            id={`${String(i).padStart(2, "0")}-${name.replace(/[^a-zA-Z0-9]+/g, "-")}`}
            component={Scene}
            durationInFrames={b(start + beats) - b(start)}
            fps={FPS}
            width={1920}
            height={1080}
          />
        ))}
      </Folder>
    </>
  );
};
