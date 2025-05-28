import type { IExecuteFunctions } from 'n8n-workflow';
import type { INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

export class Commander implements INodeType
{
	description: INodeTypeDescription = {
		displayName: 'Execute Commander',
		name: 'commander',
		icon: 'file:commander.svg',
		group: ['core'],
		version: 1,
		description: 'Execute shell commands on the host using child_process',
		defaults: {
			name: 'Execute Commander',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		properties: [
			{
				displayName: 'Execution Once',
				name: 'runOnce',
				type: 'boolean',
				default: true,
				description:
					'Whether to execute the command once for all items or for each item individually',
			},
			{
				displayName: 'Hidden Window',
				name: 'hideWindow',
				type: 'boolean',
				default: false,
				description: 'Whether to hide the command window when executing the command (only relevant on Windows)',
			},
			{
				displayName: 'Execution Mode',
				name: 'execMode',
				type: 'options',
				options: [
					{
						name: 'Exec',
						value: 'exec',
						description: 'Use child_process.exec (captures output, suitable for short commands)',
					},
					{
						name: 'Spawn',
						value: 'spawn',
						description:
							'Use child_process.spawn (streams output, suitable for long-running commands or continuous output)',
					},
				],
				default: 'exec',
				description: 'Choose whether to use exec (for small outputs) or spawn (for streaming larger outputs or continuous output) for execution',
			},
			{
				displayName: 'Command',
				name: 'command',
				type: 'string',
				default: '',
				placeholder: 'e.g., echo "Hello, n8n!"',
				description: 'The shell command to execute',
				required: true,
			},

		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>
	{
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const execAsync = promisify(exec);

		const runOnce = this.getNodeParameter('runOnce', 0) as boolean;
		const hideWindow = this.getNodeParameter('hideWindow', 0) as boolean;
		const execMode = this.getNodeParameter('execMode', 0) as string;
		const command = this.getNodeParameter('command', 0) as string;

		if (runOnce) {
			// Execute the command once for all items
			try {
				let stdout = '';
				let stderr = '';

				if (execMode === 'exec') {
					const result = await execAsync(command, { windowsHide: hideWindow });
					stdout = result.stdout;
					stderr = result.stderr;
				} else {
					// Use spawn for streaming
					const [cmd, ...args] = command.split(' ');
					const process = spawn(cmd, args, { windowsHide: hideWindow });

					await new Promise((resolve, reject) => {
						process.stdout.on('data', (data) => {
							stdout += data.toString();
						});
						process.stderr.on('data', (data) => {
							stderr += data.toString();
						});
						process.on('error', (error) => reject(error));
						process.on('close', (code) => {
							if (code !== 0) {
								reject(new Error(`Command exited with code ${code}`));
							} else {
								resolve(null);
							}
						});
					});
				}

				// Apply the same output to all items
				for (let i = 0; i < items.length; i++) {
					returnData.push({
						json: {
							stdout,
							stderr,
							command,
						},
						pairedItem: { item: i },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					for (let i = 0; i < items.length; i++) {
						returnData.push({
							json: { error: error.message },
							pairedItem: { item: i },
						});
					}
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Command execution failed: ${error.message}`,
					);
				}
			}
		} else {
			// Execute the command for each item
			for (let i = 0; i < items.length; i++) {
				try {
					const command = this.getNodeParameter('command', i) as string;
					let stdout = '';
					let stderr = '';

					if (execMode === 'exec') {
						const result = await execAsync(command);
						stdout = result.stdout;
						stderr = result.stderr;
					} else {
						// Use spawn for streaming
						const [cmd, ...args] = command.split(' ');
						const process = spawn(cmd, args);

						await new Promise((resolve, reject) => {
							process.stdout.on('data', (data) => {
								stdout += data.toString();
							});
							process.stderr.on('data', (data) => {
								stderr += data.toString();
							});
							process.on('error', (error) => reject(error));
							process.on('close', (code) => {
								if (code !== 0) {
									reject(new Error(`Command exited with code ${code}`));
								} else {
									resolve(null);
								}
							});
						});
					}

					returnData.push({
						json: {
							stdout,
							stderr,
							command,
						},
						pairedItem: { item: i },
					});
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: error.message },
							pairedItem: { item: i },
						});
						continue;
					}
					throw new NodeOperationError(
						this.getNode(),
						`Command execution failed: ${error.message}`,
					);
				}
			}
		}

		return [returnData];
	}

}
