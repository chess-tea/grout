open TestFramework;

describe("Example", ({test}) => {
  test("1", ({expect}) => {
    let actual = 42;
    let expected = 42;
    expect.int(actual).toBe(expected);
  });

  test("2", ({expect}) => {
    let actual = "42";
    expect.string(actual).toMatchSnapshot();
  });

  test("3", ({expect}) => {
    let actual = Grout.x;
    let expected = 42;

    expect.int(actual).toBe(expected);
  });
});
