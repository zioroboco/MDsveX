import {
	Point,
	Node,
	BaseSvelteTag,
	SvelteTag,
	Property,
	SvelteElement,
	Directive,
	Text,
	Literal,
	Root,
	SvelteExpression,
} from 'svast';

import {
	ParserOptions,
	Result,
	State,
	SLASH,
	CLOSE_ANGLE_BRACKET,
	COLON,
	EQUALS,
	QUOTE,
	APOSTROPHE,
	TAB,
	CLOSE_BRACE,
	BACKTICK,
} from './types_and_things';

import {
	LINEFEED,
	OPEN_ANGLE_BRACKET,
	OPEN_BRACE,
	UPPERCASE_A,
	UPPERCASE_Z,
	LOWERCASE_A,
	LOWERCASE_Z,
	SPACE,
	PIPE,
} from './types_and_things';

import { void_els } from './void_els';

function default_eat(value: string) {
	return function apply(node: Node): Node {
		return node;
	};
}

const pos: Point & { index?: number } = {
	line: 1,
	column: 1,
	offset: 0,
};

function is_in_range(number: number, from: number, to: number): boolean {
	return number >= from && number <= to;
}

function is_upper_alpha(code: number) {
	return is_in_range(code, UPPERCASE_A, UPPERCASE_Z);
}

function is_lower_alpha(code: number) {
	return is_in_range(code, LOWERCASE_A, LOWERCASE_Z);
}

function is_void_element(tag_name: string): boolean {
	return void_els.includes(tag_name);
}

export function parseNode(opts: ParserOptions): Result | undefined {
	let index = 0;
	let quote_type = '';
	let current_prop: unknown;
	let current_prop_value;
	let current_modifier;
	let closing_tag_name = '';
	let brace_count = 0;

	let {
		value,
		currentPosition = {
			line: 1,
			column: 1,
			offset: 0,
		},
		block = true,
		childParser,
	} = opts;

	// TODO: remove this
	const lineFeed = '\n';
	const lineBreaksExpression = /\r\n|\r/g;
	value = value.replace(lineBreaksExpression, lineFeed);

	const position = Object.assign(currentPosition, { index });

	function chomp() {
		// newline means new line
		if (value.charCodeAt(index) === LINEFEED) {
			position.line++;
			position.column = 1;
		} else {
			// otherwise shift along the column pointer
			position.column++;
		}

		// refers to the current parse
		index++;

		//@ts-ignore
		position.offset++;
		// stay in sync
		position.index = index;
	}

	let done;
	let error;
	let node: Node = {
		type: '',
	};
	const state: State[] = [];

	function get_state() {
		return state[state.length - 1];
	}

	while (!done && !error) {
		// console.log(value[index], state, value.charCodeAt(index));
		if (!value[index]) break;

		// right at the start
		if (!get_state()) {
			// "<" => tag
			if (value.charCodeAt(index) === OPEN_BRACE) {
				state.push('IN_EXPRESSION');
				node = <SvelteExpression>{
					type: 'svelteExpression',
					value: '',
				};
				chomp();
				continue;
			}

			if (value.charCodeAt(index) === OPEN_ANGLE_BRACKET) {
				state.push('IN_START_TAG');
				node = <BaseSvelteTag>{
					type: '',
					tagName: '',
					properties: [],
					selfClosing: false,
					children: [],
				};
				chomp();
				continue;
			}

			// "{" => expression or block
			if (value.charCodeAt(index) === OPEN_BRACE) {
				chomp();
				// expression or svelte block
				// state.push('IN_EXPRESSION');
			}
		}

		if (get_state() === 'IN_START_TAG') {
			if (value.charCodeAt(index) === SLASH) return undefined;
			// lowercase characters for element names
			if (is_lower_alpha(value.charCodeAt(index))) {
				(node as BaseSvelteTag).type = 'svelteElement';
				state.push('IN_TAG_NAME');
				continue;
			}

			// uppercase characters for Component names
			if (is_upper_alpha(value.charCodeAt(index))) {
				(node as BaseSvelteTag).type = 'svelteComponent';
				state.push('IN_TAG_NAME');
				continue;
			}

			if (
				value.charCodeAt(index) === SPACE ||
				value.charCodeAt(index) === TAB ||
				value.charCodeAt(index) === LINEFEED
			) {
				chomp();
				continue;
			}
		}

		// we are inside a tags name
		if (get_state() === 'IN_TAG_NAME') {
			// space or linefeed put us into the tag body
			if (
				value.charCodeAt(index) === SPACE ||
				value.charCodeAt(index) === TAB ||
				value.charCodeAt(index) === LINEFEED
			) {
				state.pop();
				state.push('IN_TAG_BODY');
				chomp();
				continue;
			}

			if (value.charCodeAt(index) === CLOSE_ANGLE_BRACKET) {
				state.pop();
				state.push('IN_TAG_BODY');
				continue;
			}

			(node as SvelteTag).tagName += value[index];
			chomp();
			continue;
		}

		// we are inside a start tag after the name
		if (get_state() === 'IN_TAG_BODY') {
			// letters mean we've hit an attribute
			if (
				is_lower_alpha(value.charCodeAt(index)) ||
				is_upper_alpha(value.charCodeAt(index))
			) {
				state.push('IN_ATTR_NAME');
				current_prop = <Property>{
					type: 'svelteProperty',
					name: '',
					value: [],
					modifiers: [],
					shorthand: 'none',
				};

				(node as BaseSvelteTag).properties.push(current_prop as Property);

				continue;
			}

			// "/" or  ">" (for void tags) put us in a terminal state
			if (
				value.charCodeAt(index) === SLASH ||
				(value.charCodeAt(index) === CLOSE_ANGLE_BRACKET &&
					is_void_element((node as SvelteElement).tagName))
			) {
				state.pop();
				state.push('IN_CLOSING_SLASH');
				(node as BaseSvelteTag).selfClosing = true;
				if (value.charCodeAt(index) === SLASH) chomp();
				continue;
			}

			if (value.charCodeAt(index) === CLOSE_ANGLE_BRACKET) {
				state.pop();
				state.push('PARSE_CHILDREN');
				chomp();
				continue;
			}

			if (
				value.charCodeAt(index) === SPACE ||
				value.charCodeAt(index) === TAB ||
				value.charCodeAt(index) === LINEFEED
			) {
				chomp();
				continue;
			}
		}

		// we are expecting the tag to close completely here
		if (get_state() === 'IN_CLOSING_SLASH') {
			// ignore ws
			if (
				value.charCodeAt(index) === SPACE ||
				value.charCodeAt(index) === TAB ||
				value.charCodeAt(index) === LINEFEED
			) {
				chomp();
				continue;
			}
			// we closed successfully, end the parse
			if (value.charCodeAt(index) === CLOSE_ANGLE_BRACKET) {
				chomp();
				break;
			}

			// DANGER ZONE - something went wrong
		}

		// we are parsing a property name
		if (get_state() === 'IN_ATTR_NAME') {
			let s;
			// " ", "\n", "/" or ">" => shorthand boolean attr

			if (
				(s = value.charCodeAt(index)) === SPACE ||
				s === TAB ||
				s === LINEFEED ||
				s === SLASH ||
				s === CLOSE_ANGLE_BRACKET
			) {
				(current_prop as Property).shorthand = 'boolean';
				state.pop();
				continue;
			}

			// ":" => directive
			if (value.charCodeAt(index) === COLON) {
				//@ts-ignore
				(current_prop as Directive).type = 'svelteDirective';
				(current_prop as Directive).specifier = '';
				state.pop();
				state.push('IN_DIRECTIVE_SPECIFIER');
				chomp();
				continue;
			}

			if (value.charCodeAt(index) === PIPE) {
				current_modifier = { value: '', type: 'modifier' };
				(current_prop as Directive).modifiers.push(current_modifier as Literal);
				state.pop();
				state.push('IN_ATTR_MODIFIER');
				chomp();
				continue;
			}

			if (value.charCodeAt(index) === EQUALS) {
				state.pop();
				state.push('IN_ATTR_VALUE');
				chomp();
				continue;
			}

			// process the token and chomp, everything is good
			(node as BaseSvelteTag).properties[
				(node as BaseSvelteTag).properties.length - 1
			].name += value[index];
			chomp();
			continue;
		}

		// att values can be quoted or unquoted
		if (get_state() === 'IN_ATTR_VALUE') {
			// quoted attr
			let s;
			// " ", "\n", "/" or ">" => ends the whole thing
			if (
				(s = value.charCodeAt(index)) === SPACE ||
				s === TAB ||
				s === LINEFEED
			) {
				chomp();
				continue;
			}
			if (
				value.charCodeAt(index) === QUOTE ||
				value.charCodeAt(index) === APOSTROPHE
			) {
				state.pop();
				state.push('IN_QUOTED_ATTR_VALUE');
				quote_type = value[index];

				current_prop_value = { type: 'text', value: '' };
				(current_prop as Property).value.push(current_prop_value as Text);

				chomp();
				continue;
			}

			// unquoted
			state.pop();
			state.push('IN_UNQUOTED_ATTR_VALUE');

			current_prop_value = { type: 'text', value: '' };
			(current_prop as Property).value.push(current_prop_value as Text);

			continue;
		}

		if (get_state() === 'IN_UNQUOTED_ATTR_VALUE') {
			let s;
			// " ", "\n", "/" or ">" => ends the whole thing
			if (
				(s = value.charCodeAt(index)) === SPACE ||
				s === TAB ||
				s === LINEFEED ||
				s === SLASH ||
				s === CLOSE_ANGLE_BRACKET
			) {
				state.pop();
				continue;
			}

			(current_prop_value as Text).value += value[index];
			chomp();
			continue;
		}

		if (get_state() === 'IN_QUOTED_ATTR_VALUE') {
			// if we meet our matching quote the attribute has ended
			if (value[index] === quote_type) {
				//end
				state.pop();
				chomp();
				continue;
			}

			let s;
			// " ", "\n" => still in the attribute value but make a new node
			if (
				(s = value.charCodeAt(index)) === SPACE ||
				s === TAB ||
				s === LINEFEED
			) {
				current_prop_value = { type: 'text', value: '' };
				(current_prop as Property).value.push(current_prop_value as Text);

				chomp();
				continue;
			}

			// let s;
			// " ", "\n", "/" or ">" => shorthand boolean attr
			if (
				(s = value.charCodeAt(index)) === SLASH ||
				s === CLOSE_ANGLE_BRACKET
			) {
				// this is a parsing error, we can't recover from this.
			}

			// capture the token otherwise
			(current_prop_value as Text).value += value[index];

			chomp();
			continue;
		}

		if (get_state() === 'IN_DIRECTIVE_SPECIFIER') {
			if (value.charCodeAt(index) === EQUALS) {
				state.pop();
				state.push('IN_ATTR_VALUE');
				chomp();
				continue;
			}

			if (value.charCodeAt(index) === PIPE) {
				current_modifier = { value: '', type: 'modifier' };
				(current_prop as Directive).modifiers.push(current_modifier as Literal);
				state.pop();
				state.push('IN_ATTR_MODIFIER');
				chomp();
				continue;
			}

			let s;
			// " ", "\n", "/" or ">" => ends the whole thing
			if (
				(s = value.charCodeAt(index)) === SPACE ||
				s === TAB ||
				s === LINEFEED ||
				s === SLASH ||
				s === CLOSE_ANGLE_BRACKET
			) {
				state.pop();
				continue;
			}

			(current_prop as Directive).specifier += value[index];
			chomp();
			continue;
		}

		if (get_state() === 'IN_ATTR_MODIFIER') {
			if (value.charCodeAt(index) === PIPE) {
				current_modifier = { value: '', type: 'modifier' };
				(current_prop as Directive).modifiers.push(current_modifier as Literal);

				chomp();
				continue;
			}

			if (value.charCodeAt(index) === EQUALS) {
				state.pop();
				state.push('IN_ATTR_VALUE');
				chomp();
				continue;
			}

			let s;
			if (
				(s = value.charCodeAt(index)) === SPACE ||
				s === TAB ||
				s === LINEFEED
			) {
				chomp();
				continue;
			}

			if (s === SLASH || s === CLOSE_ANGLE_BRACKET) {
				state.pop();
				continue;
			}
			(current_modifier as Literal).value += value[index];
			chomp();
			continue;
		}

		if (get_state() === 'PARSE_CHILDREN') {
			const [children, lastIndex] = childParser({
				value: value.slice(index),
				currentPosition,
				childParser,
			});
			node.children = children;
			// position = position = Object.assign(
			// 	{},
			// 	//@ts-ignore
			// 	node.children[node.children.length - 1].position.end
			// );
			position.index += lastIndex;
			index = position.index;
			state.pop();
			state.push('EXPECT_END');
		}

		if (get_state() === 'EXPECT_END') {
			let s;

			if (value.charCodeAt(index) === OPEN_ANGLE_BRACKET) {
				chomp();
				continue;
			}

			if (value.charCodeAt(index) === SLASH) {
				chomp();
				continue;
			}

			if (value.charCodeAt(index) === SPACE) {
				chomp();
				continue;
			}

			if (value.charCodeAt(index) === CLOSE_ANGLE_BRACKET) {
				if (closing_tag_name !== node.tagName) {
					console.log('something bad happened');
				}
				chomp();
				break;
			}

			closing_tag_name += value[index];
			chomp();
			continue;
		}

		if (get_state() === 'IN_TEXT') {
			if (
				value.charCodeAt(index) === OPEN_ANGLE_BRACKET ||
				value.charCodeAt(index) === OPEN_BRACE
			) {
				break;
			}

			node.value += value[index];
			chomp();
			continue;
		}

		if (get_state() === 'IN_EXPRESSION') {
			if (quote_type === '' && value.charCodeAt(index) === CLOSE_BRACE) {
				if (brace_count === 0) break;
				brace_count--;
			}

			if (quote_type === '' && value.charCodeAt(index) === OPEN_BRACE) {
				brace_count++;
			}

			if (
				quote_type === '' &&
				(value.charCodeAt(index) === APOSTROPHE ||
					value.charCodeAt(index) === QUOTE ||
					value.charCodeAt(index) === BACKTICK ||
					value.charCodeAt(index) === SLASH)
			) {
				state.push('IN_EXPRESSION_QUOTE');
				quote_type = value[index];
				node.value += value[index];
				chomp();
				continue;
			}

			node.value += value[index];
			chomp();
			continue;
		}

		if (get_state() === 'IN_EXPRESSION_QUOTE') {
			if (value[index] === quote_type) {
				quote_type = '';
				node.value += value[index];
				chomp();
				state.pop();
				continue;
			}

			node.value += value[index];
			chomp();
			continue;
		}

		state.push('IN_TEXT');
		node = {
			type: 'text',
			value: '',
		};
	}

	return {
		chomped: value.slice(0, index),
		unchomped: value.slice(index),
		parsed: node,
		position,
	};
}

function parse_siblings(opts: ParserOptions): [Node[], number] {
	const {
		value,
		currentPosition = {
			line: 1,
			column: 1,
			offset: 0,
		},
		// block = true,
		childParser = parse_siblings,
	} = opts;

	const children = [];

	let unchomped = value;
	let position = Object.assign({}, currentPosition);
	let parsed;
	let index = 0;
	let result;
	for (;;) {
		result = parseNode({
			value: unchomped,
			currentPosition: position,
			childParser,
		});
		if (!result) break;
		({ position, unchomped, parsed } = result);
		//@ts-ignore

		index += position.index;

		children.push(parsed);
		if (unchomped.trim().length === 0) break;
	}

	return [children, index];
}

export function parse(opts: ParserOptions): Root {
	const lineFeed = '\n';
	const lineBreaksExpression = /\r\n|\r/g;

	const root = <Root>{
		type: 'root',
		children: parse_siblings({
			value: opts.value.replace(lineBreaksExpression, lineFeed),
			childParser: parse_siblings,
		})[0],
	};

	return root;
}
