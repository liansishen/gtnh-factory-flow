// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setLocale } from "@/lib/i18n/locale";
import { RateBox, RuleKey, wheelHandlerFor } from "./rail-controls";

const sfx = vi.hoisted(() => ({ sfxClick: vi.fn(), playEditSfx: vi.fn() }));
vi.mock("@/lib/sound/sfx", async (original) => ({
  ...(await original<typeof import("@/lib/sound/sfx")>()),
  sfxClick: sfx.sfxClick,
  playEditSfx: sfx.playEditSfx,
}));

afterEach(() => {
  cleanup();
  sfx.sfxClick.mockClear();
  sfx.playEditSfx.mockClear();
  setLocale("en");
});

const tip = () => ({ title: "" }) as never;

it("the rate box clicks for itself and ticks before every wheel step", () => {
  const onStartEdit = vi.fn();
  const onWheel = vi.fn();
  const { container } = render(
    <RateBox
      text="3"
      gold
      editing={false}
      initial="3"
      onStartEdit={onStartEdit}
      onCommit={vi.fn()}
      onCancel={vi.fn()}
      onWheel={onWheel}
      tip={tip}
      label="Rate"
    />,
  );
  const box = container.querySelector(".rail-box")!;
  expect(box.hasAttribute("data-sfx-own")).toBe(true);
  fireEvent.click(box);
  expect(sfx.sfxClick).toHaveBeenCalledTimes(1);
  expect(onStartEdit).toHaveBeenCalledTimes(1);
  const step = wheelHandlerFor(box)!;
  step(1, false, false);
  step(-1, true, false);
  expect(sfx.playEditSfx.mock.calls).toEqual([
    ["ui.tick", 1, 1.12],
    ["ui.tick", 1, 0.9],
  ]);
  expect(onWheel.mock.calls).toEqual([
    [1, false, false],
    [-1, true, false],
  ]);
});

it("the wheel over an open box steps what it holds, set when the box is let go of", () => {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const step = (text: string, direction: 1 | -1) => String(Number(text) + direction);
  const open = (onWheelDraft?: typeof step) =>
    render(
      <RateBox
        text="3"
        gold
        editing
        initial="3"
        onStartEdit={vi.fn()}
        onCommit={onCommit}
        onCancel={onCancel}
        onWheelDraft={onWheelDraft}
        tip={tip}
        label="Count"
      />,
    ).container.querySelector<HTMLInputElement>("input")!;
  const input = open(step);
  // The rail's one wheel listener finds the open box as it finds a box at rest.
  const wheel = wheelHandlerFor(input)!;
  act(() => wheel(1, false, false));
  act(() => wheel(1, false, false));
  expect(input.value).toBe("5");
  // Nothing is set while it is open.
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledWith(5);
  cleanup();

  // Escape drops the steps with the typing.
  const again = open(step);
  act(() => wheelHandlerFor(again)!(-1, false, false));
  expect(again.value).toBe("2");
  fireEvent.keyDown(again, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledTimes(1);
  cleanup();

  // A box that steps nothing leaves the wheel to the list.
  expect(wheelHandlerFor(open())).toBeUndefined();
});

it("an open box with onLive sets as it goes: wheel steps at once, typing once it rests, Escape puts it back", () => {
  vi.useFakeTimers();
  try {
    const onLive = vi.fn();
    const onRevert = vi.fn();
    const onCommit = vi.fn();
    const input = render(
      <RateBox
        text="3"
        gold
        editing
        initial="3"
        onStartEdit={vi.fn()}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onWheelDraft={(text, direction) => String(Number(text) + direction)}
        onLive={onLive}
        onRevert={onRevert}
        tip={tip}
        label="Count"
      />,
    ).container.querySelector<HTMLInputElement>("input")!;
    act(() => wheelHandlerFor(input)!(1, false, false));
    expect(onLive.mock.calls).toEqual([[4]]);
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(input, { target: { value: "12" } });
    expect(onLive.mock.calls).toEqual([[4]]);
    act(() => vi.advanceTimersByTime(300));
    expect(onLive.mock.calls).toEqual([[4], [12]]);
    // An emptied box is a number being retyped: never cleared while typing.
    fireEvent.change(input, { target: { value: "" } });
    act(() => vi.advanceTimersByTime(300));
    expect(onLive).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("a middle click clears a set box or key with the board's unpin sound, and never autoscrolls", () => {
  const onMiddle = vi.fn();
  const { container } = render(
    <>
      <RateBox
        text="3"
        gold
        editing={false}
        initial="3"
        onStartEdit={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onMiddle={onMiddle}
        tip={tip}
        label="Set"
      />
      <RateBox
        text=""
        gold={false}
        editing={false}
        initial=""
        onStartEdit={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onMiddle={onMiddle}
        tip={tip}
        label="Empty"
      />
      <RuleKey mark="=" tone="gold" tip={tip} onMiddle={onMiddle} label="Key" />
    </>,
  );
  const [set, empty] = [...container.querySelectorAll(".rail-box")];
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
  set!.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  fireEvent(set!, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
  fireEvent(
    container.querySelector(".rail-rule")!,
    new MouseEvent("auxclick", { bubbles: true, button: 1 }),
  );
  expect(onMiddle).toHaveBeenCalledTimes(2);
  expect(sfx.playEditSfx.mock.calls).toEqual([["board.unpin"], ["board.unpin"]]);
  // Nothing set: the clear runs, quietly.
  fireEvent(empty!, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
  expect(onMiddle).toHaveBeenCalledTimes(3);
  expect(sfx.playEditSfx).toHaveBeenCalledTimes(2);
});

it("the rule key clicks for itself", () => {
  const onClick = vi.fn();
  const { container } = render(
    <RuleKey mark="~" tone="muted" tip={tip} onClick={onClick} label="Rule" />,
  );
  const key = container.querySelector(".rail-rule")!;
  expect(key.hasAttribute("data-sfx-own")).toBe(true);
  fireEvent.click(key);
  expect(sfx.sfxClick).toHaveBeenCalledTimes(1);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("an unset rate box shows its prompt through the dictionary", () => {
  render(
    <RateBox
      text=""
      gold={false}
      editing={false}
      initial=""
      onStartEdit={vi.fn()}
      onCommit={vi.fn()}
      onCancel={vi.fn()}
      tip={tip}
      label="Rate"
    />,
  );
  expect(screen.getByText("Set")).toBeTruthy();
  act(() => setLocale("zh-CN"));
  expect(screen.getByText("设置")).toBeTruthy();
  act(() => setLocale("en"));
});
