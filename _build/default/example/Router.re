
type route =
  | One
  | Two
  | Three({name: string});

include Grout.Make({
  type t = route;
  let default = Two;
});
