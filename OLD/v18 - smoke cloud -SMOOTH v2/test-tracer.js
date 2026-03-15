setInterval(() => {
  if (window.AtomFluidEngine) {
    console.log("Splats:", window.AtomFluidEngine.getTotalSplats());
    if (window.State && window.State.signals.length > 0) {
      console.log("Acc:", window.State.signals[0]._emissionAccumulator);
      if (window.State.signals[0]._virtEmitAccs) {
          console.log("Accs:", window.State.signals[0]._virtEmitAccs[0]);
      }
    }
  }
}, 1000);
