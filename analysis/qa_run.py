"""QA plots of the lyric alignment per section -> analysis/qa/words_<section>.png"""
import common
import json
import qa_plot

lyr = json.loads((common.DATA / "lyrics.json").read_text())
sec = json.loads((common.DATA / "sections.json").read_text())["sections"]
ww = json.loads((common.WORK / "whisper_turbo_prompt.json").read_text())
wtrack = [(w["word"].strip(), w["start"], w["end"]) for s in ww["segments"] for w in s.get("words", [])]
for s in sec:
    words = [(w["w"], w["start"], w["end"]) for l in lyr["lines"] for w in l["words"]]
    qa_plot.plot(s["start"] - 0.5, s["end"] + 0.5, [("ctc", words), ("whisper", wtrack)],
                 common.QA / f"words_{s['key']}.png", title=s["name"])
    print("plot", s["key"])
