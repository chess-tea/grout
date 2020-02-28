open Revery;

let run = () => {
  let init = app => {
    Timber.App.enable();
    Timber.App.setLevel(Timber.Level.debug);
    Timber.App.setNamespaceFilter("-Revery");

    let window = Revery.App.createWindow(app, "Grout Example");
    let update = Revery.UI.start(window, <MainView />);
    let _ = update;
    ();
  };

  let _ = Revery.App.start(init);
};

run();
