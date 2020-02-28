open Revery;

module Router = {
  type route =
    | Primary
    | Secondary;
};

let run = () => {
  let init = app => {
    Timber.App.enable();
    Timber.App.setLevel(Timber.Level.debug);
    Timber.App.setNamespaceFilter("-Revery");

    let window = Revery.App.createWindow(app, "Grout Example");
    let update = Revery.UI.start(window, <MainView />);

    // let () = Router.init(WindowManager.update, RouteMapping.route);

    // let element = RouteMapping.route(Router.get(), url);
    ();
  };

  let _ = Revery.App.start(init);
};

run();
