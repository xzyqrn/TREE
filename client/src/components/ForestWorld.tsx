import { useEffect, useRef, useState } from "react";

import { useIsMobile } from "@/hooks/use-mobile";
import type { ChunkWindowChange, SceneJumpTarget } from "@/components/forest/types";
import { IsometricForestController } from "@/components/forest/isometric/isometric-forest-controller";
import type { UserStats, WorldBootstrap, WorldChunk } from "@shared/schema";

interface ForestWorldProps {
  worldConfig: Pick<WorldBootstrap, "chunkSize" | "cellSize" | "renderRadiusChunks" | "preloadRadiusChunks" | "initialChunk" | "initialFocus">;
  chunks: WorldChunk[];
  statsMap: Record<string, UserStats>;
  selectedUser: string | null;
  movementEnabled?: boolean;
  jumpTarget: SceneJumpTarget | null;
  onJumpHandled: () => void;
  onSelectUser: (username: string | null) => void;
  onChunkWindowChange: (center: ChunkWindowChange) => void;
  onVisibleTrackedUsersChange: (usernames: string[]) => void;
  onHoverUserChange?: (username: string | null) => void;
  onSceneReady?: () => void;
}

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

function controlButton(active: boolean, compact = false) {
  const size = compact ? 40 : 44;
  return {
    width: size,
    height: size,
    border: "3px solid #5f4f33",
    background: active ? "#f5e6a9" : "#d3bd83",
    color: "#3f321b",
    display: "grid",
    placeItems: "center",
    boxShadow: active ? "0 0 0 2px rgba(255,245,195,0.55) inset" : "inset 0 -4px 0 rgba(95,79,51,0.25)",
    fontFamily: "Silkscreen, monospace",
    fontSize: compact ? 11 : 12,
    userSelect: "none" as const,
    touchAction: "none" as const,
  };
}

export default function ForestWorld({
  worldConfig,
  chunks,
  statsMap,
  selectedUser,
  movementEnabled = true,
  jumpTarget,
  onJumpHandled,
  onSelectUser,
  onChunkWindowChange,
  onVisibleTrackedUsersChange,
  onHoverUserChange,
  onSceneReady,
}: ForestWorldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<IsometricForestController | null>(null);
  const isMobile = useIsMobile();
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [touchVector, setTouchVector] = useState({ x: 0, z: 0 });

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    const controller = new IsometricForestController({
      canvas: canvasRef.current,
      size,
      worldConfig,
      chunks,
      statsMap,
      selectedUser,
      callbacks: {
        onSelectUser,
        onChunkWindowChange,
        onVisibleTrackedUsersChange,
        onHoverUserChange,
        onSceneReady,
      },
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setSize(size);
  }, [size]);

  useEffect(() => {
    controllerRef.current?.setWorldData(worldConfig, chunks, statsMap);
  }, [worldConfig, chunks, statsMap]);

  useEffect(() => {
    controllerRef.current?.setSelectedUser(selectedUser);
  }, [selectedUser]);

  useEffect(() => {
    controllerRef.current?.setTouchVector(touchVector.x, touchVector.z);
  }, [touchVector]);

  useEffect(() => {
    if (!movementEnabled) {
      setTouchVector({ x: 0, z: 0 });
    }
    controllerRef.current?.setMovementEnabled(movementEnabled);
  }, [movementEnabled]);

  useEffect(() => {
    if (!jumpTarget) return;
    controllerRef.current?.jumpToUser(jumpTarget);
    onJumpHandled();
  }, [jumpTarget, onJumpHandled]);

  useEffect(() => {
    window.render_game_to_text = () => JSON.stringify(controllerRef.current?.getRenderState() ?? {});
    window.advanceTime = (ms: number) => controllerRef.current?.advanceTime(ms);
    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        data-testid="forest-world-canvas"
        style={{
          position: "absolute",
          inset: 0,
          width: size.w,
          height: size.h,
          imageRendering: "pixelated",
          touchAction: "none",
          cursor: "pointer",
        }}
      />

      {isMobile && movementEnabled && (
        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 20,
            zIndex: 16,
            display: "grid",
            gridTemplateColumns: "repeat(3, 40px)",
            gridTemplateRows: "repeat(3, 40px)",
            gap: 4,
          }}
        >
          <div />
          <button
            aria-label="Move up"
            style={controlButton(touchVector.z === -1, true)}
            onPointerDown={() => setTouchVector({ x: 0, z: -1 })}
            onPointerUp={() => setTouchVector({ x: 0, z: 0 })}
            onPointerLeave={() => setTouchVector({ x: 0, z: 0 })}
          >
            UP
          </button>
          <div />
          <button
            aria-label="Move left"
            style={controlButton(touchVector.x === -1, true)}
            onPointerDown={() => setTouchVector({ x: -1, z: 0 })}
            onPointerUp={() => setTouchVector({ x: 0, z: 0 })}
            onPointerLeave={() => setTouchVector({ x: 0, z: 0 })}
          >
            LT
          </button>
          <button
            aria-label="Stop movement"
            style={controlButton(false, true)}
            onPointerDown={() => setTouchVector({ x: 0, z: 0 })}
          >
            OK
          </button>
          <button
            aria-label="Move right"
            style={controlButton(touchVector.x === 1, true)}
            onPointerDown={() => setTouchVector({ x: 1, z: 0 })}
            onPointerUp={() => setTouchVector({ x: 0, z: 0 })}
            onPointerLeave={() => setTouchVector({ x: 0, z: 0 })}
          >
            RT
          </button>
          <div />
          <button
            aria-label="Move down"
            style={controlButton(touchVector.z === 1, true)}
            onPointerDown={() => setTouchVector({ x: 0, z: 1 })}
            onPointerUp={() => setTouchVector({ x: 0, z: 0 })}
            onPointerLeave={() => setTouchVector({ x: 0, z: 0 })}
          >
            DN
          </button>
          <div />
        </div>
      )}
    </div>
  );
}
